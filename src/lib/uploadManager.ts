import { createFolder, encryptAndSaveFile } from "./vaultBridge";
import { TransferSpeedTracker } from "./transferSpeed";

export interface FileWithPath {
  file: File;
  relativePath: string;
}

export interface UploadProgressState {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
  currentFile: string | null;
  etaSeconds: number | null;
  status: "uploading" | "done" | "error";
  message?: string;
}

export interface UploadOutcome {
  renamed: string[];
  folderCount: number;
}

/**
 * Does the actual upload work: creates any staged folders, then encrypts and
 * saves each file, reporting progress (with a live ETA) after every chunk.
 * Deliberately just a plain async function rather than something tied to a
 * component's lifecycle — the caller owns state and can keep calling this
 * (and showing its progress) no matter which page is currently mounted.
 */
export async function runUpload(
  fileEntries: FileWithPath[],
  folderPaths: string[],
  onProgress: (state: UploadProgressState) => void,
): Promise<UploadOutcome> {
  // Folders first, shallowest first — an empty subfolder (or a branch that's
  // empty at every level) only survives the upload if its own entry is
  // created explicitly, since a plain list of files has no way to represent
  // "this directory exists but has nothing in it."
  const sortedFolders = [...folderPaths].sort((a, b) => a.split("/").length - b.split("/").length);
  for (const folderPath of sortedFolders) {
    await createFolder(folderPath);
  }

  if (fileEntries.length === 0) {
    return { renamed: [], folderCount: folderPaths.length };
  }

  const totalBytes = fileEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  const tracker = new TransferSpeedTracker(0);
  const renamed: string[] = [];
  let completedBytes = 0;

  const emit = (completedFiles: number, currentFile: string | null) => {
    tracker.sample(completedBytes);
    onProgress({
      completedFiles,
      totalFiles: fileEntries.length,
      completedBytes,
      totalBytes,
      currentFile,
      etaSeconds: tracker.etaSeconds(totalBytes - completedBytes),
      status: "uploading",
    });
  };

  emit(0, fileEntries[0]?.relativePath ?? null);

  for (const [index, { file, relativePath }] of fileEntries.entries()) {
    const bytesBeforeThisFile = completedBytes;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Progress (and the speed sample feeding the ETA) updates as each chunk
    // of *this* file lands, not just between files — otherwise a single
    // large file leaves the bar (and the ETA) sitting frozen for as long as
    // it takes, which reads as hung rather than working.
    const savedAs = await encryptAndSaveFile(relativePath, bytes, (bytesSent) => {
      completedBytes = bytesBeforeThisFile + bytesSent;
      emit(index, relativePath);
    });
    if (savedAs !== relativePath) {
      renamed.push(`${relativePath} → ${savedAs}`);
    }
    completedBytes = bytesBeforeThisFile + file.size;
    emit(index + 1, index + 1 < fileEntries.length ? fileEntries[index + 1].relativePath : null);
  }

  return { renamed, folderCount: folderPaths.length };
}
