import type { UploadProgressState } from "../lib/uploadManager";
import { formatEta } from "../lib/transferSpeed";

interface UploadToastProps {
  progress: UploadProgressState | null;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The floating bottom-right "Uploading..." card is the other unmistakable
// Drive/Dropbox/OneDrive signature — background work shows as a small,
// non-blocking card instead of taking over the page. Rendered at the App
// level (not inside the Vault page) specifically so it keeps showing —
// with a live, adaptive ETA — no matter which tab you navigate to while an
// upload is still running.
export default function UploadToast({ progress, onDismiss }: UploadToastProps) {
  if (!progress) return null;

  const percent =
    progress.totalBytes > 0 ? Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100)) : 100;

  const icon = progress.status === "error" ? "⚠️" : progress.status === "done" ? "✅" : "⬆️";
  const title =
    progress.status === "error"
      ? "Upload failed"
      : progress.status === "done"
        ? "Upload complete"
        : `Encrypting ${Math.min(progress.completedFiles + 1, progress.totalFiles)} of ${progress.totalFiles}`;
  const barColor = progress.status === "error" ? "bg-red-500" : progress.status === "done" ? "bg-emerald-500" : "bg-blue-500";

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="text-lg">{icon}</span>
        <p className="flex-1 truncate text-sm font-semibold text-ink">{title}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
      <div className="px-4 py-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all duration-200 ${barColor}`} style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">
            {progress.message ?? (progress.status === "uploading" ? progress.currentFile ?? "Finishing up…" : "")}
          </span>
          <span className="shrink-0 pl-2 font-medium">
            {progress.status === "uploading" ? formatEta(progress.etaSeconds) : `${percent}%`}
          </span>
        </div>
        {progress.status === "uploading" && progress.totalBytes > 0 && (
          <p className="mt-1 text-right text-xs text-slate-400">
            {formatBytes(progress.completedBytes)} / {formatBytes(progress.totalBytes)}
          </p>
        )}
      </div>
    </div>
  );
}
