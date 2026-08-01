import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import PageHeader from "../components/PageHeader";
import ActionButton from "../components/ActionButton";
import ConfirmDialog from "../components/ConfirmDialog";
import pkg from "../../package.json";
import { getErrorMessage } from "../lib/errors";
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

const ALL_CATEGORY = "All Apps";

export default function AppStore() {
  const [apps, setApps] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ProgressState>>({});
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);

  async function refresh() {
    try {
      setApps(await getAppCatalog());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load app catalog."));
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
      setError(getErrorMessage(err, `Failed to install ${entry.name}.`));
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
      setError(getErrorMessage(err, `Failed to uninstall ${uninstallTarget.name}.`));
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

  async function handleLaunch(entry: CatalogEntry) {
    if (!entry.launcherPath) return;
    setError(null);
    try {
      await launchPortableApp(entry.launcherPath);
    } catch (err) {
      setError(getErrorMessage(err, `Failed to launch ${entry.name}.`));
    }
  }

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const app of apps) {
      seen.add(app.category ?? "Other");
    }
    return [ALL_CATEGORY, ...Array.from(seen).sort((a, b) => a.localeCompare(b))];
  }, [apps]);

  const installedCount = useMemo(() => apps.filter((app) => app.installed).length, [apps]);

  const visibleApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return apps.filter((app) => {
      const category = app.category ?? "Other";
      if (activeCategory !== ALL_CATEGORY && category !== activeCategory) return false;
      if (!query) return true;
      return app.name.toLowerCase().includes(query) || app.description.toLowerCase().includes(query);
    });
  }, [apps, activeCategory, searchQuery]);

  return (
    <div>
      <PageHeader icon="🛍️" title="App Store" subtitle="Portable binaries install straight into /Apps on this drive." />

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>
      )}

      {/* PortableApps.com-style toolbar: search + category rail */}
      <div className="neo-panel mb-6 flex flex-col gap-4 bg-white p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔎</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search portable apps…"
            className="neo-input w-full py-2.5 pl-9 pr-4 text-sm"
          />
        </div>
        <p className="shrink-0 text-sm font-semibold text-slate-600">
          {installedCount} of {apps.length} installed
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`neo-border rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              activeCategory === category ? "bg-neo-blue text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="font-semibold text-slate-700">Loading catalog...</p>
      ) : apps.length === 0 ? (
        <div className="neo-card p-8 text-center font-semibold text-slate-600">
          No catalog apps are available yet.
        </div>
      ) : visibleApps.length === 0 ? (
        <div className="neo-card p-8 text-center font-semibold text-slate-600">
          No apps match "{searchQuery}" {activeCategory !== ALL_CATEGORY ? `in ${activeCategory}` : ""}.
        </div>
      ) : (
        // Rows, not cards — the classic PortableApps.com Platform layout:
        // an icon tile on the left, name/description/badges in the middle,
        // install/launch action pinned to the right of each row.
        <div className="neo-panel divide-y divide-slate-200 overflow-hidden bg-white">
          {visibleApps.map((app) => {
            const isInstalling = installingIds.has(app.id);
            const appProgress = progress[app.id];
            const percent = appProgress?.totalBytes
              ? Math.min(100, Math.round((appProgress.downloadedBytes / appProgress.totalBytes) * 100))
              : null;

            return (
              <div key={app.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-3xl ring-1 ring-slate-200">
                    {app.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold text-ink">{app.name}</p>
                      {app.category && (
                        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
                          {app.category}
                        </span>
                      )}
                      {app.installed && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          Installed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">{app.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs font-medium text-slate-500">
                      {app.sizeBytes !== null && <span>{formatBytes(app.sizeBytes)}</span>}
                      {app.installKind && <span>{app.installKind}</span>}
                    </div>

                    {isInstalling && (
                      <div className="mt-2 max-w-xs space-y-1">
                        <div className="neo-border h-2.5 w-full overflow-hidden bg-white">
                          <div
                            className={`h-full bg-neo-green transition-all ${percent === null ? "animate-pulse" : ""}`}
                            style={{ width: percent !== null ? `${percent}%` : "100%" }}
                          />
                        </div>
                        <p className="text-xs font-medium text-slate-500">
                          {appProgress?.stage === "extracting"
                            ? "Extracting…"
                            : percent !== null
                              ? `Downloading… ${percent}%`
                              : "Downloading…"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                  {!app.available ? (
                    <ActionButton type="button" disabled className="w-full sm:w-auto">
                      Unavailable on this OS
                    </ActionButton>
                  ) : app.installed ? (
                    <>
                      <ActionButton type="button" onClick={() => handleLaunch(app)} variant="primary">
                        ▶ Launch
                      </ActionButton>
                      <ActionButton type="button" onClick={() => requestUninstall(app)}>
                        🗑 Uninstall
                      </ActionButton>
                    </>
                  ) : (
                    <>
                      <ActionButton
                        type="button"
                        onClick={() => requestInstall(app)}
                        disabled={isInstalling}
                        variant="primary"
                      >
                        {isInstalling ? "Installing…" : "⬇ Install"}
                      </ActionButton>
                      {app.homepage && (
                        <ActionButton
                          type="button"
                          onClick={() =>
                            app.homepage &&
                            openUrl(app.homepage).catch((err) => console.error("Failed to open homepage link", err))
                          }
                        >
                          Info
                        </ActionButton>
                      )}
                    </>
                  )}
                </div>
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

      <footer className="mt-8 text-center text-sm text-slate-600">
        Version {pkg.version} · Portable binary: Lockbox
      </footer>
    </div>
  );
}
