interface UploadPreviewPanelProps {
  paths: string[];
  uploading: boolean;
  progress: {
    completedFiles: number;
    totalFiles: number;
    completedBytes: number;
    totalBytes: number;
    currentFile: string | null;
  } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function renderLines(paths: string[]): string[] {
  return Array.from(new Set(paths))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      const normalized = path.replace(/\\/g, "/");
      const parts = normalized.split("/").filter(Boolean);
      const depth = Math.max(0, parts.length - 1);
      const leaf = parts[parts.length - 1] || normalized;
      return `${"  ".repeat(depth)}${leaf}`;
    });
}

export default function UploadPreviewPanel({
  paths,
  uploading,
  progress,
  onCancel,
  onConfirm,
}: UploadPreviewPanelProps) {
  const lines = renderLines(paths);
  const MAX_LINES = 80;
  const shownLines = lines.slice(0, MAX_LINES);
  const hiddenCount = Math.max(0, lines.length - shownLines.length);

  return (
    <div className="neo-panel mb-6 bg-paper p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Upload Preview</p>
          <p className="text-sm font-medium text-slate-600">
            {paths.length} file{paths.length === 1 ? "" : "s"} staged for encryption
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCancel} disabled={uploading} className="neo-btn px-4 py-2">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={uploading}
            className="neo-btn bg-neo-green px-4 py-2 text-white"
          >
            {uploading ? "Encrypting…" : "Encrypt and Save"}
          </button>
        </div>
      </div>

      {uploading && progress && (
        <div className="mb-4 space-y-2">
          <div className="neo-border h-3 w-full overflow-hidden bg-slate-100">
            <div
              className="h-full bg-neo-blue transition-all duration-200"
              style={{ width: `${Math.min(100, Math.round((progress.completedBytes / Math.max(1, progress.totalBytes)) * 100))}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>
              {progress.completedFiles}/{progress.totalFiles} files
            </span>
            <span>
              {Math.min(100, Math.round((progress.completedBytes / Math.max(1, progress.totalBytes)) * 100))}% complete
            </span>
          </div>
          {progress.currentFile && (
            <p className="truncate text-sm font-medium text-slate-700">Working on: {progress.currentFile}</p>
          )}
        </div>
      )}

      <div className="neo-border max-h-72 overflow-auto bg-white p-3 font-mono text-xs text-ink/80">
        {shownLines.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
        {hiddenCount > 0 && (
          <div className="mt-2 font-semibold text-slate-600">...and {hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
