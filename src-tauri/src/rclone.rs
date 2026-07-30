use crate::cloud_config::CloudRemoteConfig;
use crate::usb_root;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

const REMOTE_NAME: &str = "lockbox_remote";

/// USB_ROOT/Tools/{win,mac,linux}/rclone(.exe) — the embedded, per-OS
/// binary. Nothing here assumes rclone is installed on the host.
pub fn rclone_binary_path(root: &Path) -> PathBuf {
    let os_dir = usb_root::tools_os_dir(root);
    if cfg!(target_os = "windows") {
        os_dir.join("rclone.exe")
    } else {
        os_dir.join("rclone")
    }
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
    let rclone_path = rclone_binary_path(&root);
    if !rclone_path.is_file() {
        return Err(format!(
            "rclone binary not found at {} — place the platform build under Tools/",
            rclone_path.display()
        ));
    }

    let vault_dir = usb_root::vault_dir(&root);
    // `rclone sync` mirrors source onto dest, deleting anything in dest that
    // isn't in source. An empty (or inaccessible) Vault would make it wipe
    // out the entire existing remote backup — refuse outright rather than
    // risk that, before spending any time on the download/obscure work below.
    if !vault_has_content(&vault_dir)? {
        return Err(
            "Vault is empty — refusing to sync (this would erase the existing remote backup). Add files to the vault first.".to_string(),
        );
    }

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
    let null_config_path = if cfg!(target_os = "windows") { "NUL" } else { "/dev/null" };

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
        },
    );

    if status.success() {
        Ok(())
    } else {
        Err(format!("rclone exited with status {status}"))
    }
}

/// True if `vault_dir` has at least one non-hidden entry. Used as a
/// pre-flight check before `rclone sync`, since syncing an empty directory
/// would delete everything already on the remote.
fn vault_has_content(vault_dir: &Path) -> Result<bool, String> {
    let entries =
        std::fs::read_dir(vault_dir).map_err(|e| format!("failed to read vault: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read vault entry: {e}"))?;
        if !entry.file_name().to_string_lossy().starts_with('.') {
            return Ok(true);
        }
    }
    Ok(false)
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
/// just keeps the value from being a bare plaintext string. `rclone obscure -`
/// reads the plaintext from stdin so it's never passed as a CLI argument
/// (which other local processes could read off the command line).
///
/// Note: this relies on `rclone obscure` accepting `-` for stdin input,
/// which matches the stdin convention rclone uses elsewhere (`rclone cat -`,
/// etc). Verify against `rclone help obscure` for the exact rclone version
/// you embed if this doesn't behave as expected — it could not be tested
/// against a real rclone binary in this environment.
fn obscure_password(rclone_path: &Path, plaintext: &str) -> Result<String, String> {
    let mut child = std::process::Command::new(rclone_path)
        .arg("obscure")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run rclone obscure: {e}"))?;

    {
        // `.take()`, not `.as_mut()` — the child reads until EOF, and EOF
        // only happens once this end of the pipe is actually closed, which
        // requires the ChildStdin handle itself to be dropped (not just the
        // borrow), hence taking ownership and letting it drop at block end.
        let mut stdin = child
            .stdin
            .take()
            .ok_or("failed to open rclone obscure stdin")?;
        stdin
            .write_all(plaintext.as_bytes())
            .map_err(|e| format!("failed to write password to rclone obscure: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("rclone obscure failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "rclone obscure failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
