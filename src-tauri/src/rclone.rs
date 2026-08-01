use crate::cloud_config::CloudRemoteConfig;
use crate::usb_root;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

const REMOTE_NAME: &str = "lockbox_remote";

/// USB_ROOT/Tools/rclone.exe — the embedded binary. Nothing here assumes
/// rclone is installed on the host.
pub fn rclone_binary_path(root: &Path) -> PathBuf {
    usb_root::tools_dir(root).join("rclone.exe")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RcloneOutputLine {
    stream: &'static str,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncFinished {
    success: bool,
    code: Option<i32>,
    /// True when nothing was actually transferred because the vault and
    /// remote were both empty — `rclone sync` never ran at all. Without
    /// this, "skipped, nothing to do" and "actually copied files" were
    /// indistinguishable to the UI: both just resolved the same Ok(()),
    /// which is exactly the "it says it worked but nothing showed up at the
    /// destination" failure mode this field exists to rule out.
    skipped: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TestFinished {
    success: bool,
    code: Option<i32>,
}

/// Runs `rclone sync <Vault dir> <remote>:<path>` for the given config,
/// streaming stdout/stderr back to the frontend as `rclone-output` events
/// line-by-line as they arrive, and emitting `rclone-sync-finished` once the
/// process exits.
pub async fn run_rclone_sync(
    app_handle: AppHandle,
    root: PathBuf,
    config: CloudRemoteConfig,
) -> Result<(), String> {
    let rclone_path = resolve_rclone_binary(&root)?;

    let vault_dir = usb_root::vault_dir(&root);
    // Building the RCLONE_CONFIG_* env vars can shell out to `rclone obscure`
    // for password fields, which is a blocking subprocess call — keep it off
    // the async executor thread.
    let env_vars = {
        let rclone_path = rclone_path.clone();
        let config = config.clone();
        tokio::task::spawn_blocking(move || build_remote_env(&rclone_path, REMOTE_NAME, &config))
            .await
            .map_err(|e| format!("internal error preparing rclone config: {e}"))??
    };

    let target = remote_target(REMOTE_NAME, &config);
    // Force rclone to use only the remote we defined via env vars, never
    // whatever config file (if any) happens to exist on the host.
    let null_config_path = "NUL";

    // `rclone sync` mirrors source onto dest, deleting anything in dest that
    // isn't in source. If the local vault is empty, only allow this to
    // continue when the remote target is also empty (first-time setup).
    if !vault_has_content(&vault_dir)? {
        if remote_has_content(
            &rclone_path,
            &env_vars,
            &target,
            null_config_path,
        )
        .await?
        {
            return Err(
                "Vault is empty — refusing to sync because the remote already has data and a sync would erase it. Add files to the vault first, or clear the remote path and retry.".to_string(),
            );
        }

        let _ = app_handle.emit(
            "rclone-output",
            RcloneOutputLine {
                stream: "stdout",
                line: "Vault and remote path are both empty. Skipping sync as no data needs transfer.".to_string(),
            },
        );
        let _ = app_handle.emit(
            "rclone-sync-finished",
            SyncFinished {
                success: true,
                code: None,
                skipped: true,
            },
        );
        return Ok(());
    }

    let mut command = tokio::process::Command::new(&rclone_path);
    command
        .arg("sync")
        .arg(&vault_dir)
        .arg(&target)
        .arg("--progress")
        .arg("--config")
        .arg(null_config_path)
        .envs(env_vars)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start rclone: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("failed to capture rclone stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("failed to capture rclone stderr")?;

    let stdout_task = tokio::spawn(stream_lines(app_handle.clone(), stdout, "stdout"));
    let stderr_task = tokio::spawn(stream_lines(app_handle.clone(), stderr, "stderr"));

    let status = child
        .wait()
        .await
        .map_err(|e| format!("rclone process error: {e}"))?;

    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let _ = app_handle.emit(
        "rclone-sync-finished",
        SyncFinished {
            success: status.success(),
            code: status.code(),
            skipped: false,
        },
    );

    if status.success() {
        Ok(())
    } else {
        Err(format!("rclone exited with status {status}"))
    }
}

/// Runs a lightweight remote connectivity check against the configured
/// backend by listing one level from the remote target.
pub async fn run_rclone_test(
    app_handle: AppHandle,
    root: PathBuf,
    config: CloudRemoteConfig,
) -> Result<(), String> {
    let rclone_path = resolve_rclone_binary(&root)?;

    let env_vars = {
        let rclone_path = rclone_path.clone();
        let config = config.clone();
        tokio::task::spawn_blocking(move || build_remote_env(&rclone_path, REMOTE_NAME, &config))
            .await
            .map_err(|e| format!("internal error preparing rclone config: {e}"))??
    };

    let target = remote_target(REMOTE_NAME, &config);
    let null_config_path = "NUL";

    let mut command = tokio::process::Command::new(&rclone_path);
    command
        .arg("lsf")
        .arg(&target)
        .arg("--max-depth")
        .arg("1")
        .arg("--config")
        .arg(null_config_path)
        .envs(env_vars)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start rclone test: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("failed to capture rclone test stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("failed to capture rclone test stderr")?;

    let stdout_task = tokio::spawn(stream_lines(app_handle.clone(), stdout, "stdout"));
    let stderr_task = tokio::spawn(stream_lines(app_handle.clone(), stderr, "stderr"));

    let status = child
        .wait()
        .await
        .map_err(|e| format!("rclone test process error: {e}"))?;

    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let _ = app_handle.emit(
        "rclone-test-finished",
        TestFinished {
            success: status.success(),
            code: status.code(),
        },
    );

    if status.success() {
        Ok(())
    } else {
        Err(format!("rclone test exited with status {status}"))
    }
}

/// True if the vault has at least one real file blob. Used as a pre-flight
/// check before `rclone sync`, since syncing an empty directory would
/// delete everything already on the remote.
///
/// Actual file content lives under Vault/.lockbox/data/ (an index + blob
/// store, not files kept under their own names at the top of Vault/) — this
/// previously checked the top level of Vault/ directly, which only ever
/// contains the hidden .lockbox/ folder itself and so always reported
/// "empty" regardless of how much data was actually in the vault, silently
/// skipping every sync. Sharing `commands::data_dir` here (rather than
/// re-deriving the path) is what stops this drifting out of sync again if
/// the storage layout ever moves.
fn vault_has_content(vault_dir: &Path) -> Result<bool, String> {
    let data_dir = crate::commands::data_dir(vault_dir);
    let entries = match std::fs::read_dir(&data_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("failed to read vault: {e}")),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read vault entry: {e}"))?;
        if entry.metadata().map(|m| m.is_file()).unwrap_or(false) {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn remote_has_content(
    rclone_path: &Path,
    env_vars: &[(String, String)],
    target: &str,
    null_config_path: &str,
) -> Result<bool, String> {
    let output = tokio::process::Command::new(rclone_path)
        .arg("lsf")
        .arg(target)
        .arg("--max-depth")
        .arg("1")
        .arg("--config")
        .arg(null_config_path)
        .envs(env_vars.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("failed to inspect remote target: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "failed to inspect remote target before sync: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let listed = String::from_utf8_lossy(&output.stdout);
    Ok(listed.lines().any(|line| !line.trim().is_empty()))
}

async fn stream_lines<R>(app_handle: AppHandle, reader: R, stream_name: &'static str)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = app_handle.emit(
            "rclone-output",
            RcloneOutputLine {
                stream: stream_name,
                line,
            },
        );
    }
}

fn remote_target(remote_name: &str, config: &CloudRemoteConfig) -> String {
    match config {
        CloudRemoteConfig::S3 {
            bucket,
            remote_path,
            ..
        } => {
            if remote_path.is_empty() {
                format!("{remote_name}:{bucket}")
            } else {
                format!("{remote_name}:{bucket}/{remote_path}")
            }
        }
        CloudRemoteConfig::WebDav { remote_path, .. } | CloudRemoteConfig::Ftp { remote_path, .. } => {
            format!("{remote_name}:{remote_path}")
        }
    }
}

fn build_remote_env(
    rclone_path: &Path,
    remote_name: &str,
    config: &CloudRemoteConfig,
) -> Result<Vec<(String, String)>, String> {
    let prefix = format!("RCLONE_CONFIG_{}_", remote_name.to_uppercase());
    let mut env = Vec::new();

    match config {
        CloudRemoteConfig::S3 {
            endpoint,
            region,
            access_key_id,
            secret_access_key,
            ..
        } => {
            env.push((format!("{prefix}TYPE"), "s3".to_string()));
            env.push((format!("{prefix}ACCESS_KEY_ID"), access_key_id.clone()));
            env.push((
                format!("{prefix}SECRET_ACCESS_KEY"),
                secret_access_key.clone(),
            ));
            match endpoint {
                Some(endpoint) if !endpoint.is_empty() => {
                    env.push((format!("{prefix}PROVIDER"), "Other".to_string()));
                    env.push((format!("{prefix}ENDPOINT"), endpoint.clone()));
                }
                _ => {
                    env.push((format!("{prefix}PROVIDER"), "AWS".to_string()));
                    if let Some(region) = region {
                        if !region.is_empty() {
                            env.push((format!("{prefix}REGION"), region.clone()));
                        }
                    }
                }
            }
        }
        CloudRemoteConfig::WebDav {
            url,
            username,
            password,
            ..
        } => {
            env.push((format!("{prefix}TYPE"), "webdav".to_string()));
            env.push((format!("{prefix}VENDOR"), "other".to_string()));
            env.push((format!("{prefix}URL"), url.clone()));
            env.push((format!("{prefix}USER"), username.clone()));
            env.push((
                format!("{prefix}PASS"),
                obscure_password(rclone_path, password)?,
            ));
        }
        CloudRemoteConfig::Ftp {
            host,
            port,
            username,
            password,
            ..
        } => {
            env.push((format!("{prefix}TYPE"), "ftp".to_string()));
            env.push((format!("{prefix}HOST"), host.clone()));
            if let Some(port) = port {
                env.push((format!("{prefix}PORT"), port.to_string()));
            }
            env.push((format!("{prefix}USER"), username.clone()));
            env.push((
                format!("{prefix}PASS"),
                obscure_password(rclone_path, password)?,
            ));
        }
    }

    Ok(env)
}

/// rclone requires password-type config fields (webdav/ftp `pass`) to be in
/// its "obscured" form — a reversible obfuscation, not real encryption, that
/// keeps the value from being stored as a plain string in config values.
fn obscure_password(rclone_path: &Path, plaintext: &str) -> Result<String, String> {
    let output = std::process::Command::new(rclone_path)
        .arg("obscure")
        .arg(plaintext)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("rclone obscure failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "rclone obscure failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn resolve_rclone_binary(root: &Path) -> Result<PathBuf, String> {
    let bundled = rclone_binary_path(root);
    if bundled.is_file() {
        return Ok(bundled);
    }

    // Fallback to host PATH for development/desktop scenarios.
    let cmd = "rclone.exe";

    let probe = std::process::Command::new(cmd)
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if probe.is_ok() {
        return Ok(PathBuf::from(cmd));
    }

    Err(format!(
        "rclone was not found. Expected bundled binary at {} or `rclone` on PATH.",
        bundled.display()
    ))
}
