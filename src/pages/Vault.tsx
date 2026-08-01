import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import VaultFilePreview from "../components/VaultFilePreview";
import VaultTreeView from "../components/VaultTreeView";
import PicturesGrid from "../components/PicturesGrid";
import NewMenu from "../components/NewMenu";
import UploadToast from "../components/UploadToast";
import { isImageFile } from "../lib/fileKind";
import {
  createFolder,
  encryptAndSaveFile,
  listVaultFiles,
  readAndDecryptFile,
  VaultFileEntry,
  deleteVaultEntry,
  exportVaultFile,
  exportVaultFolder,
  exportVaultItems,
} from "../lib/vaultBridge";
import { mimeTypeFor } from "../lib/mime";
import { getErrorMessage } from "../lib/errors";
import CreateFolderDialog from "../components/CreateFolderDialog";
import ConfirmDialog from "../components/ConfirmDialog";
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

interface CollectedEntries {
  files: FileWithPath[];
  // Every directory encountered during the walk, including ones with no
  // files directly or indirectly inside them — collected separately from
  // `files` specifically so empty subfolders survive the upload instead of
  // silently vanishing (a plain list of files has no way to represent "this
  // directory exists but is empty").
  folders: string[];
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
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sectionView, setSectionView] = useState<"files" | "pictures">("files");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  async function refresh() {
    try {
      setFiles(await listVaultFiles());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to list vault files."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Whole-window drag detection, not just the toolbar — dropping a file
  // anywhere over the page shows the full-area "Drop to upload" overlay,
  // matching Drive/Dropbox/OneDrive rather than requiring a small target.
  useEffect(() => {
    function handleWindowDragEnter(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) return;
      dragCounter.current += 1;
      setDragActive(true);
    }
    function handleWindowDragLeave() {
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setDragActive(false);
    }
    function handleWindowDragOver(event: DragEvent) {
      event.preventDefault();
    }
    function handleWindowDrop(event: DragEvent) {
      event.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
    }

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  async function uploadFiles(fileEntries: FileWithPath[], folderPaths: string[] = []) {
    if (fileEntries.length === 0 && folderPaths.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      // Folders first, shallowest first. The backend would create missing
      // ancestors for any file automatically either way, but doing this
      // explicitly is what makes an entirely-empty subfolder (or a branch
      // that's empty at every level) actually survive the upload instead of
      // silently vanishing — a plain list of files has no way to represent
      // "this directory exists but has nothing in it."
      const sortedFolders = [...folderPaths].sort((a, b) => a.split("/").length - b.split("/").length);
      for (const folderPath of sortedFolders) {
        await createFolder(folderPath);
      }

      if (fileEntries.length === 0) {
        if (folderPaths.length > 0) {
          setNotice(`Created ${folderPaths.length} folder${folderPaths.length === 1 ? "" : "s"}.`);
        }
        setPendingUpload([]);
        setPendingFolders([]);
        await refresh();
        return;
      }

      const totalBytes = fileEntries.reduce((sum, entry) => sum + entry.file.size, 0);
      setUploadProgress({
        completedFiles: 0,
        totalFiles: fileEntries.length,
        completedBytes: 0,
        totalBytes,
        currentFile: fileEntries[0]?.relativePath ?? null,
      });

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
      setPendingFolders([]);
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, "Upload failed."));
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(null), 1200);
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

  async function collectEntryFiles(entry: WebkitFileSystemEntry): Promise<CollectedEntries> {
    if (entry.isFile) {
      const file = await fileFromEntry(entry as WebkitFileSystemFileEntry);
      const relativePath = entry.fullPath.replace(/^\//, "") || file.name;
      return { files: [{ file, relativePath }], folders: [] };
    }
    if (!entry.isDirectory) {
      return { files: [], folders: [] };
    }

    const dir = entry as WebkitFileSystemDirectoryEntry;
    // Record this directory itself — not just its contents — so it's
    // preserved even if it (or every branch under it) turns out to be empty.
    const folderPath = entry.fullPath.replace(/^\//, "") || entry.name;
    const reader = dir.createReader();
    const files: FileWithPath[] = [];
    const folders: string[] = [folderPath];

    // Chrome-style directory reader returns in chunks; keep reading until empty.
    while (true) {
      const batch = await readDirectoryEntries(reader);
      if (batch.length === 0) break;
      for (const child of batch) {
        const collected = await collectEntryFiles(child);
        files.push(...collected.files);
        folders.push(...collected.folders);
      }
    }

    return { files, folders };
  }

  async function filesFromDrop(event: React.DragEvent<HTMLDivElement>): Promise<CollectedEntries> {
    const items = Array.from(event.dataTransfer.items || []);
    const hasEntryApi = items.some((item) => typeof (item as DataTransferItemWithEntry).webkitGetAsEntry === "function");

    if (hasEntryApi) {
      const files: FileWithPath[] = [];
      const folders: string[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
        if (!entry) continue;
        const collected = await collectEntryFiles(entry);
        files.push(...collected.files);
        folders.push(...collected.folders);
      }
      if (files.length > 0 || folders.length > 0) {
        return { files, folders };
      }
    }

    // Plain (non-drag) file inputs, including the "webkitdirectory" folder
    // picker, only ever expose files — the browser gives no way to see an
    // empty directory through that API, so folders stays empty here. Any
    // non-empty folder is still fully reconstructed from the files' own
    // paths (the backend creates ancestor directories automatically).
    return { files: filesFromFileList(event.dataTransfer.files), folders: [] };
  }

  async function handleFilesChosen(fileList: FileList | null) {
    const entries = filesFromFileList(fileList);
    if (entries.length === 0) {
      setNotice("No files selected.");
      return;
    }
    setError(null);
    setNotice(null);
    setPendingUpload(entries);
    setPendingFolders([]);
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);

    const { files, folders } = await filesFromDrop(event);
    if (files.length === 0 && folders.length === 0) {
      setNotice("No files found in drop payload.");
      return;
    }

    setError(null);
    setNotice(null);
    setPendingUpload(files);
    setPendingFolders(folders);
  }

  async function confirmPendingUpload() {
    await uploadFiles(pendingUpload, pendingFolders);
  }

  function cancelPendingUpload() {
    if (uploading) return;
    setPendingUpload([]);
    setPendingFolders([]);
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
      setError(getErrorMessage(err, "Failed to decrypt file."));
    }
  }

  async function handleExport(entry: VaultFileEntry) {
    setError(null);
    setNotice(null);
    try {
      if (entry.isDir) {
        const count = await exportVaultFolder(entry.name);
        if (count !== null) {
          setNotice(`Exported ${count} file${count === 1 ? "" : "s"} from "${entry.name}".`);
        }
      } else {
        const exported = await exportVaultFile(entry.name);
        if (exported) {
          setNotice(`Exported "${entry.name}".`);
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to export from vault."));
    }
  }

  function toggleSelect(fullPath: string) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      return next;
    });
  }

  function setSelection(paths: string[]) {
    setSelectedPaths(new Set(paths));
  }

  // If a folder and one of its own descendants are both selected, only keep
  // the folder — exporting/deleting it already covers everything inside,
  // and issuing a second, redundant call for the descendant would either
  // double up the work or fail outright (e.g. delete on an already-deleted
  // child) depending on call order.
  function topLevelSelection(): string[] {
    const paths = Array.from(selectedPaths);
    return paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)));
  }

  async function handleBulkExport() {
    const paths = topLevelSelection();
    if (paths.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const count = await exportVaultItems(paths);
      if (count !== null) {
        setNotice(`Exported ${count} file${count === 1 ? "" : "s"}.`);
        setSelectedPaths(new Set());
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to export selected items."));
    } finally {
      setUploading(false);
    }
  }

  function requestBulkDelete() {
    if (selectedPaths.size === 0) return;
    setBulkDeleteConfirmOpen(true);
  }

  async function confirmBulkDelete() {
    setBulkDeleteConfirmOpen(false);
    setUploading(true);
    const paths = topLevelSelection();
    setError(null);
    setNotice(null);
    try {
      for (const path of paths) {
        await deleteVaultEntry(path);
      }
      setFiles((current) =>
        current.filter((entry) => !paths.some((path) => entry.name === path || entry.name.startsWith(`${path}/`))),
      );
      if (preview && paths.some((path) => preview.name === path || preview.name.startsWith(`${path}/`))) {
        closePreview();
      }
      setNotice(`Deleted ${paths.length} item${paths.length === 1 ? "" : "s"}.`);
      setSelectedPaths(new Set());
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete selected items."));
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  function cancelBulkDelete() {
    setBulkDeleteConfirmOpen(false);
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
      setError(getErrorMessage(err, "Failed to delete entry."));
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

  const pictureCount = useMemo(
    () => files.filter((entry) => !entry.isDir && isImageFile(entry.name)).length,
    [files],
  );

  return (
    <div className="relative">
      <PageHeader icon="🔐" title="My Vault" subtitle="Files stay encrypted on this drive. Nothing touches the host disk." />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <NewMenu
            disabled={uploading || pendingUpload.length > 0 || pendingFolders.length > 0}
            onUploadFiles={() => inputRef.current?.click()}
            onUploadFolder={() => folderInputRef.current?.click()}
            onCreateFolder={() => setCreateOpen(true)}
          />

          <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setSectionView("files")}
              className={`px-3.5 py-1.5 text-sm font-medium transition ${sectionView === "files" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              🗂️ All Files
            </button>
            <button
              type="button"
              onClick={() => setSectionView("pictures")}
              className={`px-3.5 py-1.5 text-sm font-medium transition ${sectionView === "pictures" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              🖼️ Pictures{pictureCount > 0 ? ` (${pictureCount})` : ""}
            </button>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔎</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search in vault…"
            className="neo-input w-full py-2 pl-9 pr-4 text-sm"
          />
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
        <p className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>
      )}
      {notice && (
        <p className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</p>
      )}

      <p className="mb-3 text-sm font-medium text-slate-500">
        {loading ? "Loading…" : `${files.length} item${files.length === 1 ? "" : "s"} in your vault`}
      </p>

      {files.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-3xl">📥</div>
          <p className="font-semibold text-ink">Your vault is empty</p>
          <p className="mt-1 text-sm text-slate-500">Drag files or folders anywhere on this page, or use the "+ New" button above.</p>
        </div>
      ) : sectionView === "pictures" ? (
        <PicturesGrid
          entries={files}
          searchQuery={searchQuery}
          onView={handleView}
          onDelete={requestDelete}
          onExport={handleExport}
          selectedPaths={selectedPaths}
          onToggleSelect={toggleSelect}
          onSetSelection={setSelection}
          onBulkExport={handleBulkExport}
          onBulkDelete={requestBulkDelete}
        />
      ) : (
        <VaultTreeView
          entries={files}
          searchQuery={searchQuery}
          onClearSearch={() => setSearchQuery("")}
          onView={handleView}
          onDelete={requestDelete}
          onExport={handleExport}
          selectedPaths={selectedPaths}
          onToggleSelect={toggleSelect}
          onSetSelection={setSelection}
          onBulkExport={handleBulkExport}
          onBulkDelete={requestBulkDelete}
        />
      )}

      {/* Full-page overlay while dragging a file over the window, not just a small drop target */}
      {dragActive && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-blue-600/10 backdrop-blur-[1px]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="rounded-3xl border-4 border-dashed border-blue-400 bg-white/95 px-16 py-14 text-center shadow-xl">
            <div className="text-5xl">📤</div>
            <p className="mt-4 text-xl font-semibold text-ink">Drop files to upload</p>
            <p className="mt-1 text-sm text-slate-500">Files and folders will be staged for encryption.</p>
          </div>
        </div>
      )}

      {(pendingUpload.length > 0 || pendingFolders.length > 0) && !uploading && (
        <UploadPreviewPanel
          filePaths={pendingUpload.map((item) => item.relativePath)}
          folderPaths={pendingFolders}
          totalBytes={pendingUpload.reduce((sum, item) => sum + item.file.size, 0)}
          uploading={uploading}
          onCancel={cancelPendingUpload}
          onConfirm={confirmPendingUpload}
        />
      )}

      <UploadToast progress={uploadProgress} />

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
            setError(getErrorMessage(err, "Failed to create folder."));
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

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title={`Delete ${topLevelSelection().length} item${topLevelSelection().length === 1 ? "" : "s"}?`}
        description="This action will permanently remove the selected files and folders from the vault."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmBulkDelete}
        onCancel={cancelBulkDelete}
      />
    </div>
  );
}
