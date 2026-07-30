import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import VaultFilePreview from "../components/VaultFilePreview";
import VaultTreeView from "../components/VaultTreeView";
import { createFolder, encryptAndSaveFile, listVaultFiles, readAndDecryptFile, VaultFileEntry, deleteVaultEntry } from "../lib/vaultBridge";
import { mimeTypeFor } from "../lib/mime";
import CreateFolderDialog from "../components/CreateFolderDialog";
import ConfirmDialog from "../components/ConfirmDialog";

interface PreviewState {
  name: string;
  objectUrl: string;
  mimeType: string;
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

  async function handleFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const renamed: string[] = [];
      for (const file of Array.from(fileList)) {
        const relativePath = (file as any).webkitRelativePath || file.name;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const savedAs = await encryptAndSaveFile(relativePath, bytes);
        if (savedAs !== relativePath) {
          renamed.push(`${relativePath} → ${savedAs}`);
        }
      }
      if (renamed.length > 0) {
        setNotice(`Renamed to avoid overwriting existing files: ${renamed.join(", ")}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
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
    try {
      await deleteVaultEntry(confirmTarget.name);
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

      <div className="neo-panel mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-black uppercase text-ink">
            {loading ? "Loading…" : `${files.length} item${files.length === 1 ? "" : "s"}`}
          </p>
          <p className="text-sm text-ink/60">Upload files or folders, and create nested folders directly inside the vault.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="neo-btn rounded-sm bg-neo-green px-5 py-3 text-white"
          >
            {uploading ? "Encrypting…" : "⬆️ Upload Files"}
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="neo-btn rounded-sm bg-neo-cyan px-5 py-3 text-ink"
          >
            {uploading ? "Encrypting…" : "📁 Upload Folder"}
          </button>
          <button
            type="button"
            disabled={uploading}
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
          onChange={(event) => handleFilesChosen(event.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          {...{
            webkitdirectory: true,
            directory: true,
          }}
          onChange={(event) => handleFilesChosen(event.target.files)}
        />
      </div>

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 font-black uppercase text-white">{error}</p>
      )}
      {notice && (
        <p className="neo-card mb-6 bg-neo-yellow px-4 py-3 font-bold">{notice}</p>
      )}

      <div className="">
        {files.length === 0 && !loading ? (
          <div className="neo-panel p-8 text-center font-black uppercase text-ink/60">Vault is empty. Upload files or folders to start.</div>
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
