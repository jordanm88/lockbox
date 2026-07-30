import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import ActionButton from "../components/ActionButton";
import ConfirmDialog from "../components/ConfirmDialog";
import pkg from "../../package.json";
import {
  CatalogEntry,
  getAppCatalog,
  installApp,
  launchPortableApp,
  onInstallProgress,
  uninstallApp,
} from "../lib/appStoreBridge";

interface ProgressState {
  downloadedBytes: number;
  totalBytes: number | null;
  stage: "downloading" | "extracting" | "done";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AppStore() {
  const [apps, setApps] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ProgressState>>({});
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

  async function refresh() {
    try {
      setApps(await getAppCatalog());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app catalog.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();

    const unlistenPromise = onInstallProgress((event) => {
      setProgress((current) => ({
        ...current,
        [event.appId]: {
          downloadedBytes: event.downloadedBytes,
          totalBytes: event.totalBytes,
          stage: event.stage,
        },
      }));
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleInstall(entry: CatalogEntry) {
    setInstallingIds((current) => new Set(current).add(entry.id));
    setError(null);
    try {
      await installApp(entry.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to install ${entry.name}.`);
    } finally {
      setInstallingIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
      setProgress((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    }
  }

  // Uninstall flow
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<CatalogEntry | null>(null);

  function requestUninstall(entry: CatalogEntry) {
    setUninstallTarget(entry);
    setUninstallOpen(true);
  }

  async function confirmUninstall() {
    if (!uninstallTarget) return;
    setError(null);
    try {
      await uninstallApp(uninstallTarget.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to uninstall ${uninstallTarget.name}.`);
    } finally {
      setUninstallTarget(null);
      setUninstallOpen(false);
    }
  }

  function cancelUninstall() {
    setUninstallTarget(null);
    setUninstallOpen(false);
  }

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<CatalogEntry | null>(null);

  function requestInstall(entry: CatalogEntry) {
    setConfirmTarget(entry);
    setConfirmOpen(true);
  }

  function confirmInstall() {
    if (confirmTarget) handleInstall(confirmTarget);
    setConfirmTarget(null);
    setConfirmOpen(false);
  }

  function cancelInstall() {
    setConfirmTarget(null);
    setConfirmOpen(false);
  }

  // package version available as `pkg.version`

  async function handleLaunch(entry: CatalogEntry) {
    if (!entry.launcherPath) return;
    setError(null);
    try {
      await launchPortableApp(entry.launcherPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to launch ${entry.name}.`);
    }
  }

  return (
    <div>
      <PageHeader icon="🛍️" title="App Store" subtitle="Portable binaries install straight into /Apps on this drive." />

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>
      )}

      {loading ? (
        <p className="font-semibold text-slate-700">Loading catalog...</p>
      ) : apps.length === 0 ? (
        <div className="neo-card p-8 text-center font-semibold text-slate-600">
          No catalog apps are available yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {apps.map((app) => {
            const isInstalling = installingIds.has(app.id);
            const appProgress = progress[app.id];
            const percent = appProgress?.totalBytes
              ? Math.min(100, Math.round((appProgress.downloadedBytes / appProgress.totalBytes) * 100))
              : null;

            return (
              <div key={app.id} className="neo-panel flex flex-col gap-4 p-5">
                <div className="flex items-start gap-4">
                  <span className="text-4xl">{app.icon}</span>
                  <div className="flex-1">
                    <p className="text-lg font-semibold text-ink">{app.name}</p>
                    <p className="mt-1 font-bold text-ink/60">{app.description}</p>
                    {app.sizeBytes !== null && (
                      <p className="mt-2 text-sm font-bold text-ink/40">{formatBytes(app.sizeBytes)}</p>
                    )}
                  </div>
                </div>

                {isInstalling && (
                  <div className="space-y-2">
                    <div className="neo-border h-6 w-full overflow-hidden bg-white">
                      <div
                        className={`h-full bg-neo-green transition-all ${percent === null ? "animate-pulse" : ""}`}
                        style={{ width: percent !== null ? `${percent}%` : "100%" }}
                      />
                    </div>
                    <p className="text-sm font-medium text-slate-600">
                      {appProgress?.stage === "extracting"
                        ? "Extracting…"
                        : percent !== null
                          ? `Downloading… ${percent}%`
                          : "Downloading…"}
                    </p>
                  </div>
                )}

                {!app.available ? (
                  <ActionButton type="button" disabled className="w-full">
                    Unavailable on this OS
                  </ActionButton>
                ) : app.installed ? (
                  <div className="flex gap-2">
                    <ActionButton type="button" onClick={() => handleLaunch(app)} variant="primary" className="flex-1">
                      ▶ Launch
                    </ActionButton>
                    <ActionButton type="button" onClick={() => requestUninstall(app)} className="w-36">
                      🗑 Uninstall
                    </ActionButton>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <ActionButton
                      type="button"
                      onClick={() => requestInstall(app)}
                      disabled={isInstalling}
                      variant="primary"
                    >
                      {isInstalling ? "Installing…" : "⬇ Install"}
                    </ActionButton>
                    {app.homepage && (
                      <ActionButton type="button" onClick={() => app.homepage && window.open(app.homepage, "_blank")}>Info</ActionButton>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={confirmTarget ? `Install ${confirmTarget.name}?` : "Install"}
        description={confirmTarget ? confirmTarget.description : undefined}
        confirmLabel="Install"
        cancelLabel="Cancel"
        onConfirm={confirmInstall}
        onCancel={cancelInstall}
      />

      <ConfirmDialog
        open={uninstallOpen}
        title={uninstallTarget ? `Uninstall ${uninstallTarget.name}?` : "Uninstall"}
        description={uninstallTarget ? uninstallTarget.description : undefined}
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        onConfirm={confirmUninstall}
        onCancel={cancelUninstall}
      />

      <footer className="mt-8 text-center text-sm text-ink/60">Version {pkg.version}</footer>
    </div>
  );
}
