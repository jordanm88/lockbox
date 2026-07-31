interface UploadToastProps {
  progress: {
    completedFiles: number;
    totalFiles: number;
    completedBytes: number;
    totalBytes: number;
    currentFile: string | null;
  } | null;
}

// The floating bottom-right "Uploading..." card is the other unmistakable
// Drive/Dropbox/OneDrive signature — background work shows as a small,
// non-blocking card instead of taking over the page.
export default function UploadToast({ progress }: UploadToastProps) {
  if (!progress) return null;

  const percent = Math.min(100, Math.round((progress.completedBytes / Math.max(1, progress.totalBytes)) * 100));
  const done = progress.completedFiles >= progress.totalFiles;

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="text-lg">{done ? "✅" : "⬆️"}</span>
        <p className="text-sm font-semibold text-ink">
          {done ? "Upload complete" : `Encrypting ${progress.completedFiles + 1} of ${progress.totalFiles}`}
        </p>
      </div>
      <div className="px-4 py-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-500 transition-all duration-200" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span className="truncate">{progress.currentFile ?? "Finishing up…"}</span>
          <span className="shrink-0 pl-2 font-medium">{percent}%</span>
        </div>
      </div>
    </div>
  );
}
