import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface VaultFileEntry {
  name: string;
  size: number;
  isDir: boolean;
}

export type UnlockOutcome =
  | { status: "unlocked" }
  | { status: "wrongPassphrase" }
  | { status: "totpRequired" }
  | { status: "wrongTotp" };

export function unlockVault(passphrase: string, totpCode?: string): Promise<UnlockOutcome> {
  return invoke<UnlockOutcome>("unlock_vault", { passphrase, totpCode: totpCode ?? null });
}

export function vaultExists(): Promise<boolean> {
  return invoke<boolean>("vault_exists", {});
}

export function lockVault(): Promise<void> {
  return invoke<void>("lock_vault");
}

// Fired by the backend's drive-removal watcher (see lib.rs) the moment it
// notices the vault's root is no longer reachable while unlocked — the
// vault key is already cleared from memory by the time this arrives, so the
// handler here only needs to update the UI to match, not lock anything
// itself.
export function onVaultForceLocked(handler: (reason: string) => void): Promise<UnlistenFn> {
  return listen<string>("vault-force-locked", (event) => handler(event.payload));
}

export interface VaultVerifyIssue {
  path: string;
  reason: string;
}

export interface VaultVerifyReport {
  filesChecked: number;
  broken: VaultVerifyIssue[];
  orphanedBlobs: string[];
}

export function verifyVault(): Promise<VaultVerifyReport> {
  return invoke<VaultVerifyReport>("verify_vault");
}

// Where a vault-root override (see setVaultRootOverride) currently points,
// if one's set at all. `null` means "no override — using the default
// location." Distinct from getVaultRoot, which reports where the vault
// actually ended up *this session*.
export function getVaultRootOverride(): Promise<string | null> {
  return invoke<string | null>("get_vault_root_override");
}

/**
 * Prompts with a native folder-picker, then saves the chosen folder as
 * where Lockbox should look for its vault from the *next* launch on (not
 * live — see change_passphrase's sibling doc comment in commands.rs for why
 * changing the root isn't done mid-session). Returns the chosen path, or
 * null if the user cancels the dialog without choosing one.
 *
 * Deliberately does not move any existing vault data to the new location —
 * it only changes where Lockbox looks. Callers must make that clear before
 * invoking this, since picking an empty folder here effectively points
 * Lockbox at a brand new, empty vault next time.
 */
export async function setVaultRootOverride(): Promise<string | null> {
  const picked = await open({ directory: true });
  if (!picked || Array.isArray(picked)) return null;
  await invoke<void>("set_vault_root_override", { newPath: picked });
  return picked;
}

export function clearVaultRootOverride(): Promise<void> {
  return invoke<void>("clear_vault_root_override");
}

// Re-encrypts every blob and the index under a new passphrase — see
// change_passphrase in commands.rs for why this can't be a lightweight
// operation. Rejects with a message if currentPassphrase is wrong, so the
// caller can show that inline rather than treating it as a generic failure.
export function changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
  return invoke<void>("change_passphrase", { currentPassphrase, newPassphrase });
}

export function listVaultFiles(): Promise<VaultFileEntry[]> {
  return invoke<VaultFileEntry[]>("list_vault_files");
}

export function createFolder(relativePath: string): Promise<void> {
  return invoke<void>("create_folder", { relativePath });
}

export interface StorageInfo {
  vaultUsedBytes: number;
  driveTotalBytes: number | null;
  driveFreeBytes: number | null;
}

export function getStorageInfo(): Promise<StorageInfo> {
  return invoke<StorageInfo>("get_storage_info");
}

// Where the vault actually lives on disk. On Windows this is always next to
// the running exe; on Linux (see usb_root.rs) it may be a folder the user
// picked on first run instead.
export function getVaultRoot(): Promise<string> {
  return invoke<string>("get_vault_root");
}

// `std::env::consts::OS` from the backend ("windows" | "linux" | ...) — lets
// the UI pick platform-specific copy (BitLocker/VeraCrypt vs. LUKS wording,
// eject phrasing) without a whole OS-detection plugin dependency.
export function getPlatform(): Promise<string> {
  return invoke<string>("get_platform");
}

// Large files cross the IPC boundary in chunks rather than one giant
// Vec<u8> argument/return value. A single multi-hundred-MB file sent as one
// shot means building one huge JS array and JSON-(de)serializing it in a
// single synchronous pass — that's what was freezing the UI on large
// uploads/previews. Keeping each chunk this size keeps every individual
// Array.from()/JSON pass fast, and the `await` between chunks gives the UI
// thread room to actually repaint in between.
const CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Returns the name the file was actually saved under — the backend
 * auto-renames on a collision (e.g. "photo.jpg" -> "photo (1).jpg") rather
 * than overwriting an existing file with the same name.
 *
 * `onProgress`, if given, is called after each chunk with the number of
 * bytes sent so far (not a percentage — divide by `bytes.length` yourself).
 */
export async function encryptAndSaveFile(
  name: string,
  bytes: Uint8Array,
  onProgress?: (bytesSent: number) => void,
): Promise<string> {
  const uploadId = await invoke<string>("begin_upload");
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const end = Math.min(offset + CHUNK_SIZE, bytes.length);
      const chunk = bytes.subarray(offset, end);
      await invoke<void>("append_upload_chunk", {
        uploadId,
        chunk: Array.from(chunk),
      });
      offset = end;
      onProgress?.(offset);
    }
    return await invoke<string>("finish_upload", { uploadId, relativeDest: name });
  } catch (err) {
    await invoke<void>("cancel_upload", { uploadId }).catch(() => {});
    throw err;
  }
}

/**
 * `onProgress`, if given, is called after each chunk with
 * (bytesReceivedSoFar, totalBytes).
 */
export async function readAndDecryptFile(
  relativePath: string,
  onProgress?: (bytesReceived: number, totalBytes: number) => void,
): Promise<Uint8Array> {
  const handle = await invoke<{ downloadId: string; totalBytes: number }>("begin_download", {
    relativePath,
  });
  try {
    const result = new Uint8Array(handle.totalBytes);
    let offset = 0;
    while (offset < handle.totalBytes) {
      const length = Math.min(CHUNK_SIZE, handle.totalBytes - offset);
      const chunk = await invoke<number[]>("read_download_chunk", {
        downloadId: handle.downloadId,
        offset,
        length,
      });
      result.set(chunk, offset);
      offset += chunk.length;
      onProgress?.(offset, handle.totalBytes);
    }
    return result;
  } finally {
    await invoke<void>("end_download", { downloadId: handle.downloadId }).catch(() => {});
  }
}

// Moves a file/folder to trash rather than deleting it outright — see
// delete_vault_entry in commands.rs. Use restoreVaultEntry to undo, or
// permanentlyDeleteTrashEntry/emptyTrash to actually free the space.
export function deleteVaultEntry(relativePath: string): Promise<void> {
  return invoke<void>("delete_vault_entry", { relativePath });
}

export interface TrashEntry {
  path: string;
  size: number;
  isDir: boolean;
  /** Unix seconds. */
  deletedAt: number;
}

export function listTrash(): Promise<TrashEntry[]> {
  return invoke<TrashEntry[]>("list_trash");
}

export function restoreVaultEntry(relativePath: string): Promise<void> {
  return invoke<void>("restore_vault_entry", { relativePath });
}

export function permanentlyDeleteTrashEntry(relativePath: string): Promise<void> {
  return invoke<void>("permanently_delete_trash_entry", { relativePath });
}

export function emptyTrash(): Promise<void> {
  return invoke<void>("empty_trash");
}

/** Returns how many top-level trash items were purged. */
export function purgeExpiredTrash(maxAgeSeconds: number): Promise<number> {
  return invoke<number>("purge_expired_trash", { maxAgeSeconds });
}

/**
 * Prompts the user with a native save-file dialog, then decrypts the vault
 * file and writes the plaintext there. Returns false (without touching the
 * vault) if the user cancels the dialog.
 */
export async function exportVaultFile(relativePath: string): Promise<boolean> {
  const suggestedName = relativePath.split("/").pop() || relativePath;
  const destination = await save({ defaultPath: suggestedName });
  if (!destination) return false;
  await invoke<void>("export_vault_file", { relativePath, destination });
  return true;
}

/**
 * Prompts the user with a native folder-picker dialog, then decrypts every
 * file under the given vault folder into it, preserving structure. Returns
 * the number of files exported, or null if the user cancels the dialog.
 */
export async function exportVaultFolder(relativePath: string): Promise<number | null> {
  const destinationDir = await open({ directory: true });
  if (!destinationDir || Array.isArray(destinationDir)) return null;
  return invoke<number>("export_vault_folder", { relativePath, destinationDir });
}

/**
 * Prompts once for a destination folder, then exports every selected file
 * and/or folder into it (each under its own name), for multi-select export.
 * Returns the number of files exported, or null if the user cancels.
 */
export async function exportVaultItems(relativePaths: string[]): Promise<number | null> {
  const destinationDir = await open({ directory: true });
  if (!destinationDir || Array.isArray(destinationDir)) return null;
  return invoke<number>("export_vault_items", { relativePaths, destinationDir });
}

export interface EjectResult {
  cleanedUp: string[];
  message: string;
}

/**
 * Cleans up Lockbox's own leftover temp files, locks the vault, then closes
 * Lockbox and ejects its drive once the app's own file handles on it are
 * released. Does not touch USB history in the registry, Windows Event Logs,
 * or Prefetch/Amcache — see `eject.rs` for why.
 */
export function ejectUsbDrive(): Promise<EjectResult> {
  return invoke<EjectResult>("eject_usb_drive");
}

// --- AI assistant ------------------------------------------------------

export interface AiConfig {
  enabled: boolean;
  provider: string;
  hasApiKey: boolean;
}

export function getAiConfig(): Promise<AiConfig> {
  return invoke<AiConfig>("get_ai_config");
}

export function setAiEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_ai_enabled", { enabled });
}

/** Validates the key against Anthropic before saving it — rejects with a
 * clear message (bad key, rate limited, etc.) rather than silently saving
 * something that will only fail on the first real question. */
export function setAiApiKey(provider: string, apiKey: string): Promise<void> {
  return invoke<void>("set_ai_api_key", { provider, apiKey });
}

export function clearAiApiKey(): Promise<void> {
  return invoke<void>("clear_ai_api_key");
}

/** Returns how many vault files are now indexed (metadata-only ones included). */
export function rebuildAiIndex(): Promise<number> {
  return invoke<number>("rebuild_ai_index");
}

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Sends one question plus prior turns; the backend appends relevant vault
 * file excerpts to the *new* message only (history is sent as plain text,
 * not re-padded with file content on every turn). */
export function aiChat(message: string, history: AiChatTurn[]): Promise<string> {
  return invoke<string>("ai_chat", { message, history });
}

// --- Two-factor authentication (TOTP) -----------------------------------

export interface TotpStatus {
  enabled: boolean;
}

export function getTotpStatus(): Promise<TotpStatus> {
  return invoke<TotpStatus>("get_totp_status");
}

export interface TotpSetup {
  secret: string;
  otpauthUri: string;
}

/** Generates and stages a new secret — nothing is persisted until
 * `confirmTotpSetup` verifies a real code against it. */
export function beginTotpSetup(): Promise<TotpSetup> {
  return invoke<TotpSetup>("begin_totp_setup");
}

/** Returns false (not an error) for a wrong/expired code, so the caller can
 * show an inline "that code didn't match" message and let the user retry. */
export function confirmTotpSetup(code: string): Promise<boolean> {
  return invoke<boolean>("confirm_totp_setup", { code });
}

export function cancelTotpSetup(): Promise<void> {
  return invoke<void>("cancel_totp_setup");
}

export function disableTotp(): Promise<void> {
  return invoke<void>("disable_totp");
}
