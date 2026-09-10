import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import ActionButton from "../components/ActionButton";
import ConfirmDialog from "../components/ConfirmDialog";
import { getErrorMessage } from "../lib/errors";
import { emptyTrash, listTrash, permanentlyDeleteTrashEntry, restoreVaultEntry, TrashEntry } from "../lib/vaultBridge";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDeletedAt(unixSeconds: number): string {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleString();
}

function nameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export default function Trash() {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<TrashEntry | null>(null);

  async function refresh() {
    try {
      setItems(await listTrash());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load trash."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleRestore(item: TrashEntry) {
    setBusyPath(item.path);
    setError(null);
    try {
      await restoreVaultEntry(item.path);
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, `Failed to restore "${nameFromPath(item.path)}".`));
    } finally {
      setBusyPath(null);
    }
  }

  async function handlePurgeConfirmed() {
    if (!purgeTarget) return;
    const item = purgeTarget;
    setPurgeTarget(null);
    setBusyPath(item.path);
    setError(null);
    try {
      await permanentlyDeleteTrashEntry(item.path);
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, `Failed to delete "${nameFromPath(item.path)}".`));
    } finally {
      setBusyPath(null);
    }
  }

  async function handleEmptyConfirmed() {
    setConfirmEmptyOpen(false);
    setEmptying(true);
    setError(null);
    try {
      await emptyTrash();
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to empty trash."));
    } finally {
      setEmptying(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          icon="🗑️"
          title="Trash"
          subtitle="Deleted files stay here, fully recoverable, until you empty trash."
        />
        {items.length > 0 && (
          <ActionButton
            type="button"
            variant="danger"
            onClick={() => setConfirmEmptyOpen(true)}
            disabled={emptying}
            className="shrink-0"
          >
            {emptying ? "Emptying…" : "Empty Trash"}
          </ActionButton>
        )}
      </div>

      {error && <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>}

      {loading ? (
        <p className="font-semibold text-slate-700">Loading…</p>
      ) : items.length === 0 ? (
        <div className="neo-card p-8 text-center font-semibold text-slate-600">
          Trash is empty. Files and folders you delete from the vault show up here first, not gone for good.
        </div>
      ) : (
        <div className="neo-panel divide-y divide-slate-200 overflow-hidden bg-white">
          {items.map((item) => (
            <div
              key={item.path}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink">
                  {item.isDir ? "📁" : "📄"} {nameFromPath(item.path)}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {!item.isDir && `${formatBytes(item.size)} · `}Deleted {formatDeletedAt(item.deletedAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <ActionButton
                  type="button"
                  onClick={() => handleRestore(item)}
                  disabled={busyPath === item.path}
                  variant="primary"
                >
                  {busyPath === item.path ? "Working…" : "↩ Restore"}
                </ActionButton>
                <ActionButton
                  type="button"
                  onClick={() => setPurgeTarget(item)}
                  disabled={busyPath === item.path}
                  variant="danger"
                >
                  Delete Forever
                </ActionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={purgeTarget !== null}
        title="Delete forever?"
        description={
          purgeTarget
            ? `"${nameFromPath(purgeTarget.path)}" will be permanently deleted and can't be recovered.`
            : undefined
        }
        confirmLabel="Delete Forever"
        cancelLabel="Cancel"
        onConfirm={handlePurgeConfirmed}
        onCancel={() => setPurgeTarget(null)}
      />

      <ConfirmDialog
        open={confirmEmptyOpen}
        title="Empty trash?"
        description={`All ${items.length} item(s) in trash will be permanently deleted and can't be recovered.`}
        confirmLabel="Empty Trash"
        cancelLabel="Cancel"
        onConfirm={handleEmptyConfirmed}
        onCancel={() => setConfirmEmptyOpen(false)}
      />
    </div>
  );
}
