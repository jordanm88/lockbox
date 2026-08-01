interface UploadPreviewPanelProps {
  filePaths: string[];
  folderPaths: string[];
  totalBytes: number;
  uploading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

interface PreviewLine {
  key: string;
  label: string;
  depth: number;
  isDir: boolean;
}

function depthOf(path: string): number {
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

function leafOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function buildLines(filePaths: string[], folderPaths: string[]): PreviewLine[] {
  const files = filePaths.map((path) => ({
    key: `file:${path}`,
    label: leafOf(path),
    depth: depthOf(path),
    isDir: false,
    sortKey: path,
  }));
  const folders = folderPaths.map((path) => ({
    key: `dir:${path}`,
    label: leafOf(path),
    depth: depthOf(path),
    isDir: true,
    sortKey: path,
  }));
  return [...folders, ...files].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// A real confirmation step before anything gets encrypted or written —
// shows exactly what's about to happen (file count, folder count, total
// size, and the actual tree) rather than a bare "N files staged" line, so
// there's never a surprise about what a folder upload actually contained.
export default function UploadPreviewPanel({
  filePaths,
  folderPaths,
  totalBytes,
  uploading,
  onCancel,
  onConfirm,
}: UploadPreviewPanelProps) {
  const lines = buildLines(filePaths, folderPaths);
  const MAX_LINES = 200;
  const shownLines = lines.slice(0, MAX_LINES);
  const hiddenCount = Math.max(0, lines.length - shownLines.length);

  const summaryParts = [
    filePaths.length > 0 ? `${filePaths.length} file${filePaths.length === 1 ? "" : "s"}` : null,
    folderPaths.length > 0 ? `${folderPaths.length} folder${folderPaths.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <p className="text-lg font-semibold text-ink">Confirm upload</p>
        <p className="mt-1 text-sm text-slate-500">
          {summaryParts.length > 0 ? summaryParts.join(", ") : "Nothing to upload"}
          {filePaths.length > 0 && ` — ${formatBytes(totalBytes)}`} staged for encryption.
        </p>

        <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-3 font-mono text-xs text-slate-600">
          {shownLines.map((line) => (
            <div key={line.key} style={{ paddingLeft: `${line.depth * 1.1}rem` }}>
              <span className={line.isDir ? "font-semibold text-blue-700" : "text-slate-600"}>
                {line.isDir ? "📁 " : "📄 "}
                {line.label}
                {line.isDir ? "/" : ""}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && <div className="mt-2 font-semibold text-slate-500">...and {hiddenCount} more</div>}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={uploading}
            className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Encrypting…" : "Encrypt and save"}
          </button>
        </div>
      </div>
    </div>
  );
}
