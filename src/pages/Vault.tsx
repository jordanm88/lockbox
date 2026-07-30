import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import VaultFilePreview from "../components/VaultFilePreview";
import { encryptAndSaveFile, listVaultFiles, readAndDecryptFile, VaultFileEntry } from "../lib/vaultBridge";
import { mimeTypeFor } from "../lib/mime";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "🖼️";
  if (ext === "pdf") return "📕";
  if (["doc", "docx", "txt", "md"].includes(ext)) return "📄";
  if (["zip", "7z", "rar"].includes(ext)) return "🗜️";
  return "📦";
}

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
  const inputRef = useRef<HTMLInputElement>(null);

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
        const bytes = new Uint8Array(await file.arrayBuffer());
        const savedAs = await encryptAndSaveFile(file.name, bytes);
        if (savedAs !== file.name) {
          renamed.push(`${file.name} → ${savedAs}`);
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

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.objectUrl);
    setPreview(null);
  }

  return (
    <div>
      <PageHeader icon="🔐" title="Vault" subtitle="Files stay encrypted on this drive. Nothing touches the host disk." />

      <div className="mb-6 flex items-center justify-between">
        <p className="font-black uppercase">
          {loading ? "Loading…" : `${files.length} item${files.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="neo-btn bg-neo-green px-5 py-3"
        >
          {uploading ? "Encrypting…" : "⬆️ Upload Files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleFilesChosen(event.target.files)}
        />
      </div>

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 font-black uppercase text-white">{error}</p>
      )}
      {notice && (
        <p className="neo-card mb-6 bg-neo-yellow px-4 py-3 font-bold">{notice}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {files.map((file) => (
          <button
            key={file.name}
            type="button"
            onClick={() => handleView(file)}
            className="neo-card flex items-center gap-4 p-4 text-left transition-brutal hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
          >
            <span className="text-3xl">{iconFor(file.name)}</span>
            <div className="min-w-0">
              <p className="truncate font-black">{file.name}</p>
              <p className="text-sm font-bold text-ink/60">{formatSize(file.size)}</p>
            </div>
          </button>
        ))}

        {!loading && files.length === 0 && (
          <div className="neo-card col-span-full p-8 text-center font-black uppercase text-ink/50">
            Vault is empty. Upload something.
          </div>
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
    </div>
  );
}
