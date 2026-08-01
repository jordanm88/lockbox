import type { CloudAction, RestoreStatus, SyncStatus } from "../lib/cloudSyncBridge";

interface CloudSyncToastProps {
  lastAction: CloudAction;
  syncStatus: SyncStatus;
  restoreStatus: RestoreStatus;
  lastErrorDetail: string | null;
  latestOutputLine: string | null;
  onDismiss: () => void;
}

interface ToastContent {
  icon: string;
  title: string;
  detail?: string;
  tone: "progress" | "success" | "error";
}

// Cloud Sync already shows a detailed status panel of its own while you're
// on that page — this is deliberately much lighter, just enough to notice
// from any other tab that a sync/restore is still going (or how it landed)
// without needing to switch back, same reasoning as the upload toast. Test
// connections aren't shown here: they're quick, page-local checks, not a
// background operation worth surfacing globally.
function contentFor(
  lastAction: CloudAction,
  syncStatus: SyncStatus,
  restoreStatus: RestoreStatus,
  lastErrorDetail: string | null,
  latestOutputLine: string | null,
): ToastContent | null {
  if (lastAction === "sync") {
    if (syncStatus === "running") return { icon: "☁️", title: "Syncing to cloud…", detail: latestOutputLine ?? undefined, tone: "progress" };
    if (syncStatus === "success") return { icon: "✅", title: "Cloud sync complete", tone: "success" };
    if (syncStatus === "skipped") return { icon: "⚠️", title: "Nothing to sync", detail: "Vault and remote were both empty.", tone: "success" };
    if (syncStatus === "failed") return { icon: "⚠️", title: "Cloud sync failed", detail: lastErrorDetail ?? undefined, tone: "error" };
  }
  if (lastAction === "restore") {
    if (restoreStatus === "running") return { icon: "⬇️", title: "Restoring from cloud…", detail: latestOutputLine ?? undefined, tone: "progress" };
    if (restoreStatus === "success") return { icon: "✅", title: "Restore complete", tone: "success" };
    if (restoreStatus === "failed") return { icon: "⚠️", title: "Restore failed", detail: lastErrorDetail ?? undefined, tone: "error" };
  }
  return null;
}

export default function CloudSyncToast({
  lastAction,
  syncStatus,
  restoreStatus,
  lastErrorDetail,
  latestOutputLine,
  onDismiss,
}: CloudSyncToastProps) {
  const content = contentFor(lastAction, syncStatus, restoreStatus, lastErrorDetail, latestOutputLine);
  if (!content) return null;

  const barColor = content.tone === "error" ? "bg-red-500" : content.tone === "success" ? "bg-emerald-500" : "bg-blue-500";

  return (
    <div className="fixed bottom-6 left-6 z-40 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="text-lg">{content.icon}</span>
        <p className="flex-1 truncate text-sm font-semibold text-ink">{content.title}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
      {content.detail && (
        <div className="px-4 py-3">
          <p className="truncate text-xs text-slate-500">{content.detail}</p>
          {content.tone === "progress" && (
            <div className="mt-2 h-1.5 w-full animate-pulse overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full w-1/2 rounded-full ${barColor}`} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
