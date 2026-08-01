import { invoke } from "@tauri-apps/api/core";

export interface DriveEncryptionStatus {
  protected: boolean | null;
  detail: string;
}

/**
 * Checks whether the drive Lockbox is running from is itself
 * BitLocker-protected — Lockbox only ever encrypts `Vault/`, so anything
 * outside it (installed apps and their data) relies on whole-drive
 * encryption for protection at rest.
 */
export function checkDriveEncryption(): Promise<DriveEncryptionStatus> {
  return invoke<DriveEncryptionStatus>("check_drive_encryption");
}
