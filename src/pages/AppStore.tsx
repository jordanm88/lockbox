import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import {
  CatalogEntry,
  getAppCatalog,
  installApp,
  launchPortableApp,
  onInstallProgress,
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
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 font-black uppercase text-white">{error}</p>
      )}

      {loading ? (
        <p className="font-black uppercase">Loading catalog…</p>
      ) : apps.length === 0 ? (
        <div className="neo-card p-8 text-center font-black uppercase text-ink/70">
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
                    <p className="text-lg font-black text-ink">{app.name}</p>
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
                    <p className="text-sm font-black uppercase text-ink/70">
                      {appProgress?.stage === "extracting"
                        ? "Extracting…"
                        : percent !== null
                          ? `Downloading… ${percent}%`
                          : "Downloading…"}
                    </p>
                  </div>
                )}

                {!app.available ? (
                  <button type="button" disabled className="neo-btn py-3">
                    Unavailable on this OS
                  </button>
                ) : app.installed ? (
                  <button
                    type="button"
                    onClick={() => handleLaunch(app)}
                    className="neo-btn bg-neo-blue py-3 text-white"
                  >
                    ▶ Launch
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleInstall(app)}
                    disabled={isInstalling}
                    className="neo-btn bg-neo-green py-3"
                  >
                    {isInstalling ? "Installing…" : "⬇ Install"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
