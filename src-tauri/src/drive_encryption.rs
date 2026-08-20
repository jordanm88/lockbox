use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveEncryptionStatus {
    /// `None` means "couldn't determine" (no drive letter/mount, the check
    /// tool missing, or an unparseable result), deliberately distinct from
    /// `Some(false)`, since "unknown" and "confirmed unprotected" call for
    /// very different treatment in the UI: the first shouldn't alarm anyone,
    /// the second should.
    protected: Option<bool>,
    detail: String,
}

/// Reports whether the drive Lockbox is running from is itself
/// whole-drive-encrypted (BitLocker on Windows, LUKS on Linux). Lockbox only
/// ever encrypts `Vault/` — `Apps/`, `Third Party Apps/`, and `Tools/` are
/// ordinary plaintext files on the drive, since apps installed there need to
/// read/write real files directly and can't go through Lockbox's own
/// encrypt/decrypt calls. Whole-drive encryption underneath Lockbox is the
/// only practical way to close that gap without requiring a filesystem
/// driver — see docs/SECURITY.md.
#[tauri::command(async)]
pub fn check_drive_encryption(state: State<AppState>) -> DriveEncryptionStatus {
    platform::check(&state.root)
}

#[cfg(windows)]
mod platform {
    use super::DriveEncryptionStatus;
    use crate::eject::drive_letter_of;
    use crate::process_ext;
    use std::path::Path;

    pub(super) fn check(root: &Path) -> DriveEncryptionStatus {
        let drive_letter = match drive_letter_of(root) {
            Some(letter) => letter,
            None => {
                return DriveEncryptionStatus {
                    protected: None,
                    detail: "Lockbox isn't running from a lettered drive, so its encryption \
                             status can't be checked this way."
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
        let mut cmd = std::process::Command::new("manage-bde");
        cmd.arg("-status").arg(drive_letter);
        process_ext::hide_console(&mut cmd);
        let output = cmd.output().map_err(|e| {
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

    /// `manage-bde -status <drive>` prints a `Protection Status:` line
    /// reading either "Protection On" or "Protection Off" — that's the one
    /// line that actually answers "is this drive protected right now,"
    /// regardless of conversion progress or encryption method, so it's the
    /// only thing parsed.
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
                         installed apps and their data — is stored in plain, readable form if \
                         the drive is lost or stolen."
                    .to_string(),
            },
            None => DriveEncryptionStatus {
                protected: None,
                detail: "Couldn't determine this drive's BitLocker status from the tool's \
                         output."
                    .to_string(),
            },
        }
    }
}

/// Linux equivalent of the Windows `manage-bde` check: resolves the block
/// device backing the vault via `findmnt` (shared with `eject.rs`), then
/// asks `lsblk` what kind of device it is. An unlocked LUKS volume is
/// mounted from a `/dev/mapper/...` device-mapper node whose `lsblk` `TYPE`
/// reads `crypt`; a plain, unencrypted partition's `TYPE` reads `part` (or
/// `disk` for an unpartitioned device). That's the same "protected right
/// now, regardless of details" signal `manage-bde`'s `Protection Status:`
/// line gives on Windows, from one command instead of parsing prose output.
#[cfg(target_os = "linux")]
mod platform {
    use super::DriveEncryptionStatus;
    use crate::eject::mount_source_of;
    use std::path::Path;

    pub(super) fn check(root: &Path) -> DriveEncryptionStatus {
        let (device, mountpoint) = match mount_source_of(root) {
            Some(pair) => pair,
            None => {
                return DriveEncryptionStatus {
                    protected: None,
                    detail: "Couldn't determine which drive the vault is on, so its encryption \
                             status can't be checked."
                        .to_string(),
                }
            }
        };

        if mountpoint == "/" {
            return DriveEncryptionStatus {
                protected: None,
                detail: "The vault isn't stored on a separate removable drive, so its \
                         encryption status can't be checked this way."
                    .to_string(),
            };
        }

        match run_lsblk_type(&device) {
            Ok(device_type) => classify(&device_type),
            Err(detail) => DriveEncryptionStatus {
                protected: None,
                detail,
            },
        }
    }

    fn run_lsblk_type(device: &str) -> Result<String, String> {
        let output = std::process::Command::new("lsblk")
            .arg("-no")
            .arg("TYPE")
            .arg(device)
            .output()
            .map_err(|e| {
                format!(
                    "Couldn't run `lsblk` to check this drive ({e}). It's part of util-linux \
                     and should be present on any desktop Linux install."
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!(
                "`lsblk` couldn't check this drive{}.",
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                }
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn classify(device_type: &str) -> DriveEncryptionStatus {
        if device_type == "crypt" {
            DriveEncryptionStatus {
                protected: Some(true),
                detail: "This drive is LUKS-encrypted and currently unlocked.".to_string(),
            }
        } else if device_type.is_empty() {
            DriveEncryptionStatus {
                protected: None,
                detail: "Couldn't determine this drive's encryption status from `lsblk`."
                    .to_string(),
            }
        } else {
            DriveEncryptionStatus {
                protected: Some(false),
                detail: "This drive isn't LUKS-encrypted. Anything outside the Vault — \
                         installed apps and their data — is stored in plain, readable form if \
                         the drive is lost or stolen."
                    .to_string(),
            }
        }
    }
}
