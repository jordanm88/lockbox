use crate::catalog::{self, ArchiveType, TargetSpec};
use crate::{paths, usb_root};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::env;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Sidecar file written inside `Apps/<id>/` recording where the launcher
/// actually ended up, when that differs from the catalog's declared path
/// (see `record_actual_launcher`). `store_commands.rs` checks for this
/// before falling back to the catalog's own path.
pub(crate) const LAUNCHER_RECORD_FILE: &str = ".lockbox-launcher";

// A flat overall timeout doesn't fit here: portable app sizes vary wildly
// (a ~10MB CLI tool vs. VS Code's ~335MB Electron archive), so any single
// fixed duration is either too short for a legitimate large download on an
// ordinary connection, or too long to catch a genuinely dead one quickly.
// reqwest's blocking client has no built-in per-read/stall timeout (only a
// connect timeout and a total-request timeout), so `download_with_progress`
// below builds its own: the actual socket reads happen on a background
// thread that streams chunks back over a channel, and the main thread calls
// `recv_timeout` on that channel — a timeout that resets after every chunk,
// so it only fires on an actual stall (no bytes arriving at all for this
// long), never on a slow-but-still-progressing transfer. A connection that
// can't even be established still needs its own bound.
const CONNECT_TIMEOUT_SECS: u64 = 20;
const STALL_TIMEOUT_SECS: u64 = 30;
#[cfg(windows)]
const INSTALLER_TIMEOUT: Duration = Duration::from_secs(120);
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(120);
/// Generous cap for a portable app archive — mainly a guard against a
/// misconfigured or compromised catalog entry pointing at something huge (or
/// infinite, e.g. a misbehaving server) and exhausting RAM, since the whole
/// download is buffered in memory before extraction.
const MAX_DOWNLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    app_id: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    stage: &'static str,
}

fn emit_progress(
    app_handle: &AppHandle,
    app_id: &str,
    downloaded: u64,
    total: Option<u64>,
    stage: &'static str,
) {
    let _ = app_handle.emit(
        "app-install-progress",
        InstallProgress {
            app_id: app_id.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            stage,
        },
    );
}

pub fn install_app(app_handle: &AppHandle, root: &Path, app_id: &str) -> Result<(), String> {
    let catalog = catalog::load_catalog(app_handle)?;
    let app = catalog
        .apps
        .into_iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| format!("unknown app '{app_id}'"))?;
    let target = app
        .targets
        .for_current_os()
        .ok_or_else(|| format!("'{app_id}' has no build for this operating system"))?
        .clone();

    let install_dir = usb_root::apps_dir(root).join(&app.id);

    // Always start from a clean directory: this discards any stale files
    // left over from a previous version of this app, and it gives failure
    // handling below a simple story — on any error past this point we just
    // remove the directory again, so the app ends up either fully installed
    // or entirely absent, never confusingly half-installed.
    if install_dir.exists() {
        std::fs::remove_dir_all(&install_dir)
            .map_err(|e| format!("failed to clear previous install: {e}"))?;
    }
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("failed to create app directory: {e}"))?;

    if let Err(e) = install_app_inner(app_handle, &app.id, &target, &install_dir) {
        let _ = std::fs::remove_dir_all(&install_dir);
        return Err(e);
    }

    Ok(())
}

fn install_app_inner(
    app_handle: &AppHandle,
    app_id: &str,
    target: &TargetSpec,
    install_dir: &Path,
) -> Result<(), String> {
    let bytes = download_with_progress(app_handle, app_id, target)?;

    if let Some(expected) = &target.sha256 {
        verify_sha256(&bytes, expected)?;
    }

    emit_progress(
        app_handle,
        app_id,
        bytes.len() as u64,
        Some(bytes.len() as u64),
        "extracting",
    );

    match target.archive_type {
        ArchiveType::Zip => extract_zip(&bytes, install_dir)?,
        ArchiveType::TarGz => extract_tar_gz(&bytes, install_dir)?,
        ArchiveType::Appimage => install_single_file(&bytes, install_dir, &target.launcher)?,
        ArchiveType::Binary | ArchiveType::Exe => install_single_file(&bytes, install_dir, &target.launcher)?,
        ArchiveType::Installer => install_windows_installer(app_handle, app_id, &bytes, install_dir, &target.launcher)?,
    }

    // Single-file installs always land the launcher exactly where we said
    // to — only archive-based ones can unpack into a version-named wrapper
    // folder (e.g. a zip containing `vlc-3.0.23/vlc.exe` instead of
    // `vlc.exe` at the root), which would otherwise both fail "is this
    // installed?" checks and fail to launch, and re-break every time the
    // upstream project bumps its version number. Record wherever the file
    // actually ended up instead of assuming the catalog's declared path.
    if matches!(target.archive_type, ArchiveType::Zip | ArchiveType::TarGz) {
        record_actual_launcher(install_dir, &target.launcher)?;
    }

    emit_progress(
        app_handle,
        app_id,
        bytes.len() as u64,
        Some(bytes.len() as u64),
        "done",
    );
    Ok(())
}

fn download_with_progress(
    app_handle: &AppHandle,
    app_id: &str,
    target: &TargetSpec,
) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("failed to build download client: {e}"))?;

    let mut response = client
        .get(&target.url)
        .send()
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?;

    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_DOWNLOAD_BYTES) {
        return Err(format!(
            "refusing to download {app_id}: reported size exceeds the {}GB limit",
            MAX_DOWNLOAD_BYTES / (1024 * 1024 * 1024)
        ));
    }

    // The blocking read happens on its own thread so the main thread can
    // bound each chunk's wait with `recv_timeout` instead of blocking
    // forever on a stalled socket (reqwest's blocking client has no
    // per-read timeout knob). If we give up below, this thread is left to
    // finish or fail on its own dead socket — a rare, harmless leak on an
    // already-erroring path rather than something worth cancelling.
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    thread::spawn(move || {
        let mut chunk = [0u8; 64 * 1024];
        loop {
            match response.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(Ok(chunk[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("download failed: {e}")));
                    break;
                }
            }
        }
    });

    let mut buffer = Vec::new();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let stall_timeout = Duration::from_secs(STALL_TIMEOUT_SECS);

    loop {
        let chunk = match rx.recv_timeout(stall_timeout) {
            Ok(Ok(chunk)) => chunk,
            Ok(Err(e)) => return Err(e),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(format!(
                    "download stalled: no data received for {STALL_TIMEOUT_SECS}s"
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        // Backstop for when content-length was absent or understated —
        // stop pulling data from a runaway/misbehaving server rather than
        // growing `buffer` without bound.
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "aborting download of {app_id}: exceeded the {}GB limit",
                MAX_DOWNLOAD_BYTES / (1024 * 1024 * 1024)
            ));
        }

        if last_emit.elapsed() > PROGRESS_EMIT_INTERVAL {
            emit_progress(app_handle, app_id, downloaded, total, "downloading");
            last_emit = Instant::now();
        }
    }

    emit_progress(app_handle, app_id, downloaded, total, "downloading");
    Ok(buffer)
}

fn verify_sha256(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let actual_hex = hex::encode(hasher.finalize());
    if !actual_hex.eq_ignore_ascii_case(expected_hex) {
        return Err("downloaded file failed integrity check (SHA-256 mismatch)".to_string());
    }
    Ok(())
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let cursor = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("invalid zip archive: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry: {e}"))?;

        // `enclosed_name` returns None for any entry whose path contains
        // `..` or an absolute/drive-rooted component instead of silently
        // rewriting it — rejecting those outright is what stops a
        // malicious archive from writing outside `dest` ("zip slip").
        let relative_name = entry
            .enclosed_name()
            .ok_or_else(|| format!("zip entry has an unsafe path: {}", entry.name()))?;
        let out_path = dest.join(relative_name);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("failed to create directory: {e}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create directory: {e}"))?;
        }

        let mode = entry.unix_mode();
        let mut out_file = File::create(&out_path)
            .map_err(|e| format!("failed to write {}: {e}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("failed to extract {}: {e}", out_path.display()))?;

        apply_unix_permissions(&out_path, mode);
    }

    Ok(())
}

fn extract_tar_gz(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let gz = flate2::read::GzDecoder::new(Cursor::new(bytes));
    let mut archive = tar::Archive::new(gz);
    archive
        .unpack(dest)
        .map_err(|e| format!("failed to extract tar.gz archive: {e}"))
}

fn install_single_file(bytes: &[u8], dest_dir: &Path, launcher_name: &str) -> Result<(), String> {
    let dest_path = paths::safe_join(dest_dir, launcher_name)?;
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create directory: {e}"))?;
    }
    std::fs::write(&dest_path, bytes)
        .map_err(|e| format!("failed to write {}: {e}", dest_path.display()))?;
    apply_unix_permissions(&dest_path, Some(0o755));
    Ok(())
}

/// If `launcher` exists exactly where the catalog says, do nothing. If not,
/// search the whole install directory for a file with that exact name and,
/// when there's exactly one match, record its real relative path in
/// `LAUNCHER_RECORD_FILE` so lookups don't need to re-search every time.
fn record_actual_launcher(install_dir: &Path, launcher: &str) -> Result<(), String> {
    let expected = paths::safe_join(install_dir, launcher)?;
    if expected.is_file() {
        return Ok(());
    }

    let target_name = Path::new(launcher)
        .file_name()
        .ok_or_else(|| format!("launcher path '{launcher}' has no file name"))?;

    let mut matches = Vec::new();
    find_by_name(install_dir, target_name, &mut matches)?;

    let resolved = match matches.as_slice() {
        [] => {
            return Err(format!(
                "installed archive doesn't contain a file named '{}' anywhere — the catalog entry's launcher path is probably wrong for this build",
                target_name.to_string_lossy()
            ));
        }
        [single] => single
            .strip_prefix(install_dir)
            .map_err(|_| "internal error computing launcher path".to_string())?
            .to_string_lossy()
            .replace('\\', "/"),
        multiple => {
            let listed = multiple
                .iter()
                .filter_map(|p| p.strip_prefix(install_dir).ok())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "found {} files named '{}', can't tell which is the launcher: {listed}",
                multiple.len(),
                target_name.to_string_lossy()
            ));
        }
    };

    std::fs::write(install_dir.join(LAUNCHER_RECORD_FILE), &resolved)
        .map_err(|e| format!("failed to record launcher path: {e}"))?;
    Ok(())
}

fn find_by_name(dir: &Path, name: &std::ffi::OsStr, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in
        std::fs::read_dir(dir).map_err(|e| format!("failed to scan {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            find_by_name(&path, name, out)?;
        } else if path.file_name() == Some(name) {
            out.push(path);
        }
    }
    Ok(())
}

fn install_windows_installer(
    app_handle: &AppHandle,
    app_id: &str,
    bytes: &[u8],
    install_dir: &Path,
    launcher_name: &str,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = (app_handle, app_id, bytes, install_dir, launcher_name);
        return Err("Windows installer packages are only supported on Windows.".to_string());
    }

    #[cfg(windows)]
    {
        if !is_probably_windows_exe(bytes) {
            return Err(
                "downloaded installer is not a Windows executable (likely an HTML/download page instead of the file). Try again, or update the catalog entry URL.".to_string(),
            );
        }

        let temp_name = format!("lockbox-{app_id}-installer.exe");
        let temp_path = env::temp_dir().join(temp_name);
        std::fs::write(&temp_path, bytes)
            .map_err(|e| format!("failed to stage installer: {e}"))?;

        let install_dir_string = install_dir.to_string_lossy().to_string();

        // Try standard NSIS-style silent install first.
        let mut first_command = std::process::Command::new(&temp_path);
        first_command.arg("/S").arg(format!("/D={install_dir_string}"));
        let first_try = match run_with_timeout(first_command, INSTALLER_TIMEOUT) {
            Ok(output) => output,
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                return Err(e);
            }
        };

        // PortableApps installers often use /SILENT + /DESTINATION.
        let needs_fallback = !first_try.status.success()
            || !paths::safe_join(install_dir, launcher_name)?.is_file();

        let mut fallback_output_text = String::new();
        if needs_fallback {
            let mut second_command = std::process::Command::new(&temp_path);
            second_command.arg("/SILENT").arg(format!("/DESTINATION={install_dir_string}"));
            let second_try = match run_with_timeout(second_command, INSTALLER_TIMEOUT) {
                Ok(output) => output,
                Err(e) => {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(e);
                }
            };

            if !second_try.status.success() {
                let first_err = String::from_utf8_lossy(&first_try.stderr).trim().to_string();
                let second_err = String::from_utf8_lossy(&second_try.stderr).trim().to_string();
                let first_out = String::from_utf8_lossy(&first_try.stdout).trim().to_string();
                let second_out = String::from_utf8_lossy(&second_try.stdout).trim().to_string();

                let _ = std::fs::remove_file(&temp_path);

                return Err(format!(
                    "installer failed in both modes (NSIS and PortableApps). First mode status: {}. Second mode status: {}. First stderr: {}. Second stderr: {}. First stdout: {}. Second stdout: {}",
                    first_try.status,
                    second_try.status,
                    if first_err.is_empty() { "<empty>" } else { &first_err },
                    if second_err.is_empty() { "<empty>" } else { &second_err },
                    if first_out.is_empty() { "<empty>" } else { &first_out },
                    if second_out.is_empty() { "<empty>" } else { &second_out }
                ));
            }

            fallback_output_text = String::from_utf8_lossy(&second_try.stderr).trim().to_string();
        } else if !first_try.status.success() {
            let _ = std::fs::remove_file(&temp_path);
            let stderr = String::from_utf8_lossy(&first_try.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&first_try.stdout).trim().to_string();
            return Err(format!(
                "installer exited with status {}. stderr: {}. stdout: {}",
                first_try.status,
                if stderr.is_empty() { "<empty>" } else { &stderr },
                if stdout.is_empty() { "<empty>" } else { &stdout }
            ));
        }

        let _ = std::fs::remove_file(&temp_path);

        let launcher_path = paths::safe_join(install_dir, launcher_name)?;
        if !launcher_path.is_file() {
            return Err(format!(
                "installer did not create expected launcher: {}{}",
                launcher_path.display(),
                if fallback_output_text.is_empty() {
                    "".to_string()
                } else {
                    format!(" (fallback stderr: {fallback_output_text})")
                }
            ));
        }

        let _ = app_handle;
        Ok(())
    }
}

/// Runs `command` to completion, capturing stdout/stderr, but kills it and
/// returns an error if it hasn't exited within `timeout` — replaces a plain
/// `.output()` call, which blocks forever if the installer pops up a dialog
/// it can't show (e.g. a silent-install flag it doesn't actually support),
/// which is exactly what made an install attempt look like it froze the app.
#[cfg(windows)]
fn run_with_timeout(
    mut command: std::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to launch installer: {e}"))?;

    // Drain stdout/stderr on separate threads while polling for exit below —
    // reading them only after exit (like `.output()` does) risks a deadlock
    // if the child fills a pipe buffer while nothing is draining it.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "installer did not finish within {} seconds — it may be waiting on a dialog it can't show because the silent-install flag isn't actually supported. Aborted rather than hang.",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("failed to wait for installer: {e}")),
        }
    };

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();

    Ok(std::process::Output { status, stdout, stderr })
}

fn is_probably_windows_exe(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == b'M' && bytes[1] == b'Z'
}

#[cfg(unix)]
fn apply_unix_permissions(path: &Path, mode: Option<u32>) {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
}

#[cfg(not(unix))]
fn apply_unix_permissions(_path: &Path, _mode: Option<u32>) {}
