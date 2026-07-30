import { invoke } from "@tauri-apps/api/core";

export interface VaultFileEntry {
  name: string;
  size: number;
  isDir: boolean;
}

export function unlockVault(passphrase: string): Promise<boolean> {
  return invoke<boolean>("unlock_vault", { passphrase });
}

export function vaultExists(): Promise<boolean> {
  return invoke<boolean>("vault_exists", {});
}

export function lockVault(): Promise<void> {
  return invoke<void>("lock_vault");
}

export function listVaultFiles(): Promise<VaultFileEntry[]> {
  return invoke<VaultFileEntry[]>("list_vault_files");
}

export function createFolder(relativePath: string): Promise<void> {
  return invoke<void>("create_folder", { relativePath });
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

export function deleteVaultEntry(relativePath: string): Promise<void> {
  return invoke<void>("delete_vault_entry", { relativePath });
}
