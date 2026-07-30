import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import VaultFilePreview from "../components/VaultFilePreview";
import VaultTreeView from "../components/VaultTreeView";
import { createFolder, encryptAndSaveFile, listVaultFiles, readAndDecryptFile, VaultFileEntry, deleteVaultEntry } from "../lib/vaultBridge";
import { mimeTypeFor } from "../lib/mime";
import CreateFolderDialog from "../components/CreateFolderDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import DropHint from "../components/DropHint";
import UploadPreviewPanel from "../components/UploadPreviewPanel";

type FileWithPath = {
  file: File;
  relativePath: string;
};

type WebkitFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  name: string;
};

type WebkitFileSystemFileEntry = WebkitFileSystemEntry & {
  file: (successCallback: (file: File) => void, errorCallback?: (err: unknown) => void) => void;
};

type WebkitFileSystemDirectoryReader = {
  readEntries: (
    successCallback: (entries: WebkitFileSystemEntry[]) => void,
    errorCallback?: (err: unknown) => void,
  ) => void;
};

type WebkitFileSystemDirectoryEntry = WebkitFileSystemEntry & {
  createReader: () => WebkitFileSystemDirectoryReader;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
};

interface PreviewState {
  name: string;
  objectUrl: string;
  mimeType: string;
}

interface UploadProgressState {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
  currentFile: string | null;
}

export default function Vault() {
  const [files, setFiles] = useState<VaultFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<VaultFileEntry | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<FileWithPath[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setFiles(await listVaultFiles());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list vault files.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function uploadFiles(fileEntries: FileWithPath[]) {
    if (fileEntries.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    const totalBytes = fileEntries.reduce((sum, entry) => sum + entry.file.size, 0);
    setUploadProgress({
      completedFiles: 0,
      totalFiles: fileEntries.length,
      completedBytes: 0,
      totalBytes,
      currentFile: fileEntries[0]?.relativePath ?? null,
    });
    try {
      const renamed: string[] = [];
      let completedBytes = 0;
      for (const [index, { file, relativePath }] of fileEntries.entries()) {
        const bytesBeforeThisFile = completedBytes;
        setUploadProgress({
          completedFiles: index,
          totalFiles: fileEntries.length,
          completedBytes,
          totalBytes,
          currentFile: relativePath,
        });
        const bytes = new Uint8Array(await file.arrayBuffer());
        // Progress updates as each chunk of *this* file lands, not just
        // between files — otherwise a single large file leaves the bar
        // sitting still for as long as it takes, which reads as frozen.
        const savedAs = await encryptAndSaveFile(relativePath, bytes, (bytesSent) => {
          setUploadProgress({
            completedFiles: index,
            totalFiles: fileEntries.length,
            completedBytes: bytesBeforeThisFile + bytesSent,
            totalBytes,
            currentFile: relativePath,
          });
        });
        if (savedAs !== relativePath) {
          renamed.push(`${relativePath} → ${savedAs}`);
        }
        completedBytes = bytesBeforeThisFile + file.size;
        setUploadProgress({
          completedFiles: index + 1,
          totalFiles: fileEntries.length,
          completedBytes,
          totalBytes,
          currentFile: index + 1 < fileEntries.length ? fileEntries[index + 1].relativePath : null,
        });
      }
      if (renamed.length > 0) {
        setNotice(`Renamed to avoid overwriting existing files: ${renamed.join(", ")}`);
      }
      setPendingUpload([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  function filesFromFileList(fileList: FileList | null): FileWithPath[] {
    if (!fileList || fileList.length === 0) return [];
    return Array.from(fileList).map((file) => ({
      file,
      relativePath: ((file as any).webkitRelativePath as string) || file.name,
    }));
  }

  function readDirectoryEntries(reader: WebkitFileSystemDirectoryReader): Promise<WebkitFileSystemEntry[]> {
    return new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  }

  function fileFromEntry(entry: WebkitFileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
  }

  async function collectEntryFiles(entry: WebkitFileSystemEntry): Promise<FileWithPath[]> {
    if (entry.isFile) {
      const file = await fileFromEntry(entry as WebkitFileSystemFileEntry);
      const relativePath = entry.fullPath.replace(/^\//, "") || file.name;
      return [{ file, relativePath }];
    }
    if (!entry.isDirectory) {
      return [];
    }

    const dir = entry as WebkitFileSystemDirectoryEntry;
    const reader = dir.createReader();
    const all: FileWithPath[] = [];

    // Chrome-style directory reader returns in chunks; keep reading until empty.
    while (true) {
      const batch = await readDirectoryEntries(reader);
      if (batch.length === 0) break;
      for (const child of batch) {
        const childFiles = await collectEntryFiles(child);
        all.push(...childFiles);
      }
    }

    return all;
  }

  async function filesFromDrop(event: React.DragEvent<HTMLDivElement>): Promise<FileWithPath[]> {
    const items = Array.from(event.dataTransfer.items || []);
    const hasEntryApi = items.some((item) => typeof (item as DataTransferItemWithEntry).webkitGetAsEntry === "function");

    if (hasEntryApi) {
      const all: FileWithPath[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
        if (!entry) continue;
        const entryFiles = await collectEntryFiles(entry);
        all.push(...entryFiles);
      }
      if (all.length > 0) {
        return all;
      }
    }

    return filesFromFileList(event.dataTransfer.files);
  }

  async function handleFilesChosen(fileList: FileList | null) {
    const entries = filesFromFileList(fileList);
    if (entries.length === 0) {
      setNotice("No files selected.");
      return;
    }
    setError(null);
    setNotice(`Staged ${entries.length} file${entries.length === 1 ? "" : "s"}. Review and confirm encryption.`);
    setPendingUpload(entries);
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const entries = await filesFromDrop(event);
    if (entries.length === 0) {
      setNotice("No files found in drop payload.");
      return;
    }

    setError(null);
    setNotice(`Staged ${entries.length} file${entries.length === 1 ? "" : "s"} from drag and drop.`);
    setPendingUpload(entries);
  }

  async function confirmPendingUpload() {
    await uploadFiles(pendingUpload);
  }

  function cancelPendingUpload() {
    if (uploading) return;
    setPendingUpload([]);
    setNotice("Upload canceled.");
  }

  async function handleView(entry: VaultFileEntry) {
    setError(null);
    try {
      const bytes = await readAndDecryptFile(entry.name);
      const mimeType = mimeTypeFor(entry.name);
      // Blob + Object URL keeps the decrypted bytes purely in-memory — no
      // temp file ever touches the host disk.
      const blob = new Blob([bytes as BlobPart], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      setPreview({ name: entry.name, objectUrl, mimeType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decrypt file.");
    }
  }

  function requestDelete(entry: VaultFileEntry) {
    setConfirmTarget(entry);
    setConfirmOpen(true);
  }

  async function confirmDelete() {
    if (!confirmTarget) return;
    setConfirmOpen(false);
    setUploading(true);
    const deletingName = confirmTarget.name;
    try {
      await deleteVaultEntry(deletingName);
      setFiles((current) =>
        current.filter((entry) => entry.name !== deletingName && !entry.name.startsWith(`${deletingName}/`)),
      );
      if (preview && preview.name === deletingName) {
        closePreview();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entry.");
    } finally {
      setUploading(false);
      setConfirmTarget(null);
    }
  }

  function cancelDelete() {
    setConfirmOpen(false);
    setConfirmTarget(null);
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.objectUrl);
    setPreview(null);
  }

  return (
    <div>
      <PageHeader icon="🔐" title="Vault" subtitle="Files stay encrypted on this drive. Nothing touches the host disk." />

      <div
        className={`neo-panel mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between ${dragActive ? "ring-4 ring-neo-yellow" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <div>
          <p className="font-semibold text-slate-700">
            {loading ? "Loading..." : `${files.length} item${files.length === 1 ? "" : "s"}`}
          </p>
          <p className="text-sm text-slate-600">Upload files or folders, drag and drop them here, and create nested folders directly inside the vault.</p>
          <DropHint active={dragActive} />
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || pendingUpload.length > 0}
            className="neo-btn rounded-sm bg-neo-green px-5 py-3 text-white"
          >
            {uploading ? "Encrypting…" : "⬆️ Upload Files"}
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading || pendingUpload.length > 0}
            className="neo-btn rounded-sm bg-neo-cyan px-5 py-3 text-ink"
          >
            {uploading ? "Encrypting…" : "📁 Upload Folder"}
          </button>
          <button
            type="button"
            disabled={uploading || pendingUpload.length > 0}
            onClick={() => setCreateOpen(true)}
            className="neo-btn rounded-sm bg-neo-blue px-5 py-3 text-white"
          >
            Create Folder
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={async (event) => {
            await handleFilesChosen(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: "", directory: "" } as unknown as Record<string, unknown>)}
          onChange={async (event) => {
            await handleFilesChosen(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </div>

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>
      )}
      {notice && (
        <p className="neo-card mb-6 bg-neo-yellow px-4 py-3 font-bold">{notice}</p>
      )}

      {pendingUpload.length > 0 && (
        <UploadPreviewPanel
          paths={pendingUpload.map((item) => item.relativePath)}
          uploading={uploading}
          progress={uploadProgress}
          onCancel={cancelPendingUpload}
          onConfirm={confirmPendingUpload}
        />
      )}

      <div className="">
        {files.length === 0 && !loading ? (
          <div className="neo-panel p-8 text-center font-semibold text-slate-600">Vault is empty. Upload files or folders to start.</div>
        ) : (
          <VaultTreeView entries={files} onView={handleView} onDelete={requestDelete} />
        )}
      </div>

      {preview && (
        <VaultFilePreview
          name={preview.name}
          objectUrl={preview.objectUrl}
          mimeType={preview.mimeType}
          onClose={closePreview}
        />
      )}

      <CreateFolderDialog
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreate={async (name) => {
          setCreateOpen(false);
          setUploading(true);
          setError(null);
          setNotice(null);
          try {
            await createFolder(name);
            setNotice(`Created folder: ${name}`);
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create folder.");
          } finally {
            setUploading(false);
          }
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={confirmTarget ? `Delete ${confirmTarget.name}?` : "Delete entry"}
        description={confirmTarget ? "This action will permanently remove the file from the vault." : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
