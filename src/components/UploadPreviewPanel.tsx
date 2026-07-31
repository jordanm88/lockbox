interface UploadPreviewPanelProps {
  paths: string[];
  uploading: boolean;
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

// A review step before anything gets encrypted — deliberately kept as a
// small modal rather than the old full-width inline panel, since actual
// progress now lives in the floating UploadToast instead.
export default function UploadPreviewPanel({ paths, uploading, onCancel, onConfirm }: UploadPreviewPanelProps) {
  const lines = renderLines(paths);
  const MAX_LINES = 80;
  const shownLines = lines.slice(0, MAX_LINES);
  const hiddenCount = Math.max(0, lines.length - shownLines.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <p className="text-lg font-semibold text-ink">Upload preview</p>
        <p className="mt-1 text-sm text-slate-500">
          {paths.length} file{paths.length === 1 ? "" : "s"} staged for encryption.
        </p>

        <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-3 font-mono text-xs text-slate-600">
          {shownLines.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
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
