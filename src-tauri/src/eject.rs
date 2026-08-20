use crate::process_ext;
use crate::state::{lock_recover, AppState};
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EjectResult {
    cleaned_up: Vec<String>,
    message: String,
}

/// Own-temp-file suffixes cleaned up below: the self-update helper artifacts
/// this app stages outside the vault (see `updates.rs`). Windows stages a
/// `.bat` helper script plus the downloaded `.new.exe`; Linux only ever
/// stages the downloaded `.deb` (there's no in-place-swap helper script on
/// Linux — see `updates.rs::apply_linux_update`).
#[cfg(windows)]
const OWN_TEMP_FILE_SUFFIXES: &[&str] = &[".bat", ".exe"];
#[cfg(not(windows))]
const OWN_TEMP_FILE_SUFFIXES: &[&str] = &[".deb"];

/// Deletes Lockbox's own leftover temp files from the host machine — staged
/// installer downloads and the self-update helper script, the only
/// host-side artifacts this app creates outside the drive itself in normal
/// operation, since previews stay RAM-only and everything else lives on the
/// drive. Best-effort: a file that's already gone or still in use is
/// skipped, not an error, since the point is tidiness, not something else
/// depending on it succeeding.
fn cleanup_own_temp_files() -> Vec<String> {
    let mut cleaned = Vec::new();
    let temp_dir = std::env::temp_dir();

    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(entries) => entries,
        Err(_) => return cleaned,
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        let is_ours = lower.starts_with("lockbox-")
            && OWN_TEMP_FILE_SUFFIXES.iter().any(|suffix| lower.ends_with(suffix));
        if is_ours && std::fs::remove_file(entry.path()).is_ok() {
            cleaned.push(name);
        }
    }

    cleaned
}

/// Extracts a Windows drive letter like `"E:"` from a root path such as
/// `E:\` or `E:\SomeFolder`. Returns `None` for a UNC path or anything else
/// without a drive-letter prefix. Shared with `drive_encryption.rs`, which
/// needs the same drive letter to query BitLocker status for.
#[cfg(windows)]
pub(crate) fn drive_letter_of(root: &Path) -> Option<String> {
    let text = root.components().next()?.as_os_str().to_str()?;
    if text.len() >= 2 && text.as_bytes()[1] == b':' {
        Some(text[..2].to_string())
    } else {
        None
    }
}

/// Linux equivalent of `drive_letter_of`: resolves the block device and
/// mountpoint backing `root` via `findmnt`, so eject and the drive-encryption
/// check both know exactly which device (e.g. `/dev/sdb1`) and mountpoint
/// (e.g. `/media/user/LOCKBOX`, or `/` if the vault just lives under $HOME)
/// they're dealing with. `None` if `findmnt` isn't available or `root`
/// doesn't resolve to a mount at all.
#[cfg(target_os = "linux")]
pub(crate) fn mount_source_of(root: &Path) -> Option<(String, String)> {
    let output = std::process::Command::new("findmnt")
        .arg("-no")
        .arg("SOURCE,TARGET")
        .arg("--target")
        .arg(root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let source = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    Some((source, target))
}

/// Cleans up Lockbox's own leftover host-side temp files, locks the vault,
/// then closes the app and ejects the drive once our own file handles on it
/// are released — the OS won't unmount a volume while the running exe is
/// still open from it, so the actual eject has to happen from a separate
/// helper process, after this one exits.
///
/// Deliberately narrow scope: this only touches files Lockbox itself wrote.
/// It does not touch Windows' USB connection history in the registry, Event
/// Logs, Prefetch, or Amcache/Shimcache (or their Linux equivalents like
/// udev/journald history) — those are OS-level forensic records, and
/// modifying them is a fundamentally different (and far more invasive) thing
/// than tidying up after yourself. This app doesn't do that, regardless of
/// the reason requested.
#[tauri::command]
pub fn eject_usb_drive(
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<EjectResult, String> {
    let cleaned_up = cleanup_own_temp_files();

    *lock_recover(&state.vault_key) = None;

    let message = eject_platform(&state.root, cleaned_up.len())?;

    app_handle.exit(0);

    Ok(EjectResult {
        cleaned_up,
        message,
    })
}

#[cfg(windows)]
fn eject_platform(root: &Path, cleaned_up_count: usize) -> Result<String, String> {
    let drive_letter = drive_letter_of(root)
        .ok_or("Lockbox isn't running from a lettered drive, so there's nothing to eject.")?;

    spawn_eject_helper(&drive_letter)?;

    Ok(format!(
        "Cleaned up {cleaned_up_count} temp file(s) and locked the vault. Lockbox is closing so \
         drive {drive_letter} can be safely ejected — wait for Windows' \"Safe to Remove \
         Hardware\" notification before unplugging."
    ))
}

#[cfg(target_os = "linux")]
fn eject_platform(root: &Path, cleaned_up_count: usize) -> Result<String, String> {
    let (device, mountpoint) = mount_source_of(root)
        .ok_or("Couldn't determine which drive the vault is on, so there's nothing to eject.")?;

    if mountpoint == "/" {
        return Err(
            "The vault isn't stored on a separate removable drive, so there's nothing to eject."
                .to_string(),
        );
    }

    spawn_eject_helper(&device)?;

    Ok(format!(
        "Cleaned up {cleaned_up_count} temp file(s) and locked the vault. Lockbox is closing so \
         {device} can be safely removed — wait for your desktop's \"safe to remove\" \
         notification before unplugging."
    ))
}

/// Spawns a detached PowerShell helper that waits for the Lockbox process to
/// fully exit (retrying for up to ~30s) before invoking the Shell API's
/// "Eject" verb on the drive — the same action as right-clicking the drive
/// in Explorer and choosing "Eject". Detached so it keeps running after this
/// process exits.
#[cfg(windows)]
fn spawn_eject_helper(drive_letter: &str) -> Result<(), String> {
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
for ($i = 0; $i -lt 30; $i++) {{
    $proc = Get-Process -Name 'Lockbox' -ErrorAction SilentlyContinue
    if (-not $proc) {{ break }}
    Start-Sleep -Seconds 1
}}
$shell = New-Object -ComObject Shell.Application
$drive = $shell.Namespace(17).ParseName('{drive_letter}\')
if ($drive) {{ $drive.InvokeVerb('Eject') }}
"#
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-WindowStyle")
        .arg("Hidden")
        .arg("-Command")
        .arg(&script);
    process_ext::hide_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| format!("failed to launch eject helper: {e}"))?;

    Ok(())
}

/// Linux equivalent of `spawn_eject_helper` above: a detached shell helper
/// that waits for this process to fully exit (retrying for up to ~30s, same
/// bound as the Windows/PowerShell helper) before running `udisksctl` to
/// unmount and power off the device — the same action a file manager takes
/// when you click "Eject" on a drive, and (unlike a bare `umount`) doesn't
/// need root, since udisks2 grants it via polkit to the user who's logged
/// into the session that mounted the drive in the first place.
#[cfg(target_os = "linux")]
fn spawn_eject_helper(device: &str) -> Result<(), String> {
    let pid = std::process::id();
    let script = format!(
        r#"i=0
while kill -0 {pid} 2>/dev/null && [ "$i" -lt 30 ]; do
    sleep 1
    i=$((i + 1))
done
udisksctl unmount -b '{device}' >/dev/null 2>&1
udisksctl power-off -b '{device}' >/dev/null 2>&1
"#
    );

    std::process::Command::new("sh")
        .arg("-c")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to launch eject helper: {e}"))?;

    Ok(())
}
