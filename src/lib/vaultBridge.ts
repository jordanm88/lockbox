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

/**
 * Returns the name the file was actually saved under — the backend
 * auto-renames on a collision (e.g. "photo.jpg" -> "photo (1).jpg") rather
 * than overwriting an existing file with the same name.
 */
export function encryptAndSaveFile(name: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>("encrypt_and_save_file", {
    fileBytes: Array.from(bytes),
    relativeDest: name,
  });
}

export async function readAndDecryptFile(relativePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_and_decrypt_file", { relativePath });
  return new Uint8Array(bytes);
}
