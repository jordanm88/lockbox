use crate::eject::drive_letter_of;
use crate::state::AppState;
use serde::Serialize;
use std::os::windows::process::CommandExt;
use tauri::State;

/// See the identical constant in rclone.rs/eject.rs — suppresses the console
/// flash from spawning a console-subsystem helper (`manage-bde.exe`) from
/// this GUI-subsystem app.
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveEncryptionStatus {
    /// `None` means "couldn't determine" (no drive letter, `manage-bde`
    /// missing — it isn't shipped on Windows Home — or an unparseable
    /// result), deliberately distinct from `Some(false)`, since "unknown" and
    /// "confirmed unprotected" call for very different treatment in the UI:
    /// the first shouldn't alarm anyone, the second should.
    protected: Option<bool>,
    detail: String,
}

/// Reports whether the drive Lockbox is running from is itself
/// BitLocker-protected. Lockbox only ever encrypts `Vault/` — `Apps/`,
/// `Third Party Apps/`, and `Tools/` are ordinary plaintext files on the
/// drive, since apps installed there need to read/write real files directly
/// and can't go through Lockbox's own encrypt/decrypt calls. Whole-drive
/// encryption underneath Lockbox (BitLocker To Go, or VeraCrypt on editions
/// without BitLocker) is the only practical way to close that gap without
/// requiring a filesystem driver — see docs/SECURITY.md.
#[tauri::command(async)]
pub fn check_drive_encryption(state: State<AppState>) -> DriveEncryptionStatus {
    let drive_letter = match drive_letter_of(&state.root) {
        Some(letter) => letter,
        None => {
            return DriveEncryptionStatus {
                protected: None,
                detail: "Lockbox isn't running from a lettered drive, so its encryption status \
                         can't be checked this way."
                    .to_string(),
            }
        }
    };

    match run_manage_bde_status(&drive_letter) {
        Ok(output) => parse_status(&output),
        Err(detail) => DriveEncryptionStatus {
            protected: None,
            detail,
        },
    }
}

fn run_manage_bde_status(drive_letter: &str) -> Result<String, String> {
    let output = std::process::Command::new("manage-bde")
        .arg("-status")
        .arg(drive_letter)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| {
            format!(
                "Couldn't run Windows' BitLocker status tool ({e}). It isn't included in \
                 Windows Home — VeraCrypt is a free alternative that works on any edition."
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "Windows' BitLocker status tool couldn't check this drive{}.",
            if stderr.is_empty() {
                String::new()
            } else {
                format!(": {stderr}")
            }
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `manage-bde -status <drive>` prints a `Protection Status:` line reading
/// either "Protection On" or "Protection Off" — that's the one line that
/// actually answers "is this drive protected right now," regardless of
/// conversion progress or encryption method, so it's the only thing parsed.
fn parse_status(output: &str) -> DriveEncryptionStatus {
    let protection_line = output.lines().find(|line| line.contains("Protection Status:"));

    match protection_line {
        Some(line) if line.contains("Protection On") => DriveEncryptionStatus {
            protected: Some(true),
            detail: "BitLocker protection is on for this drive.".to_string(),
        },
        Some(_) => DriveEncryptionStatus {
            protected: Some(false),
            detail: "This drive isn't BitLocker-protected. Anything outside the Vault — \
                     installed apps and their data — is stored in plain, readable form if the \
                     drive is lost or stolen."
                .to_string(),
        },
        None => DriveEncryptionStatus {
            protected: None,
            detail: "Couldn't determine this drive's BitLocker status from the tool's output."
                .to_string(),
        },
    }
}
