use crate::state::{lock_recover, AppState};
use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::path::Path;
use tauri::{AppHandle, State};

/// See the identical constant in rclone.rs — same reason: without it,
/// spawning a console-subsystem helper (here, PowerShell) briefly flashes a
/// window even though `-WindowStyle Hidden` is also passed, since that only
/// takes effect once PowerShell itself starts running, after the console
/// host window has already been created.
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EjectResult {
    cleaned_up: Vec<String>,
    message: String,
}

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
        let is_ours =
            lower.starts_with("lockbox-") && (lower.ends_with(".bat") || lower.ends_with(".exe"));
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
pub(crate) fn drive_letter_of(root: &Path) -> Option<String> {
    let text = root.components().next()?.as_os_str().to_str()?;
    if text.len() >= 2 && text.as_bytes()[1] == b':' {
        Some(text[..2].to_string())
    } else {
        None
    }
}

/// Cleans up Lockbox's own leftover host-side temp files, locks the vault,
/// then closes the app and ejects the drive once our own file handles on it
/// are released — Windows won't unmount a volume while the running exe is
/// still open from it, so the actual eject has to happen from a separate
/// helper process, after this one exits.
///
/// Deliberately narrow scope: this only touches files Lockbox itself wrote.
/// It does not touch Windows' USB connection history in the registry, Event
/// Logs, Prefetch, or Amcache/Shimcache — those are OS-level forensic
/// records, and modifying them is a fundamentally different (and far more
/// invasive) thing than tidying up after yourself. This app doesn't do
/// that, regardless of the reason requested.
#[tauri::command]
pub fn eject_usb_drive(
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<EjectResult, String> {
    let cleaned_up = cleanup_own_temp_files();

    *lock_recover(&state.vault_key) = None;

    let drive_letter = drive_letter_of(&state.root)
        .ok_or("Lockbox isn't running from a lettered drive, so there's nothing to eject.")?;

    spawn_eject_helper(&drive_letter)?;

    let message = format!(
        "Cleaned up {} temp file(s) and locked the vault. Lockbox is closing so drive {} can be \
         safely ejected — wait for Windows' \"Safe to Remove Hardware\" notification before \
         unplugging.",
        cleaned_up.len(),
        drive_letter
    );

    app_handle.exit(0);

    Ok(EjectResult {
        cleaned_up,
        message,
    })
}

/// Spawns a detached PowerShell helper that waits for the Lockbox process to
/// fully exit (retrying for up to ~30s) before invoking the Shell API's
/// "Eject" verb on the drive — the same action as right-clicking the drive
/// in Explorer and choosing "Eject". Detached so it keeps running after this
/// process exits.
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

    std::process::Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-WindowStyle")
        .arg("Hidden")
        .arg("-Command")
        .arg(&script)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("failed to launch eject helper: {e}"))?;

    Ok(())
}
