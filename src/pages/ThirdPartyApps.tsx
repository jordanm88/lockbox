import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import PageHeader from "../components/PageHeader";
import ActionButton from "../components/ActionButton";
import { getErrorMessage } from "../lib/errors";
import { launchThirdPartyApp, scanThirdPartyApps, ThirdPartyApp } from "../lib/appStoreBridge";

// Third Party Apps/ is just a folder someone can drop a portable app into
// outside the App Store entirely, so there's no event to tell us when that
// happens — re-scanning it every 20s while this page is open is the
// cheapest way to have manually-added apps "just show up" without the user
// needing to know to hit refresh.
const RESCAN_MS = 20_000;

function FolderName() {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-ink">Third Party Apps\</code>;
}

export default function ThirdPartyApps() {
  const [apps, setApps] = useState<ThirdPartyApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  async function refresh() {
    try {
      setApps(await scanThirdPartyApps());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to scan Third Party Apps."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, RESCAN_MS);
    return () => clearInterval(timer);
  }, []);

  async function handleLaunch(app: ThirdPartyApp) {
    if (!app.launcherPath) return;
    setLaunchingId(app.id);
    setError(null);
    try {
      await launchThirdPartyApp(app.launcherPath);
    } catch (err) {
      setError(getErrorMessage(err, `Failed to launch ${app.name}.`));
    } finally {
      setLaunchingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        icon="📦"
        title="Third Party Apps"
        subtitle="Portable apps you add to the drive yourself, kept separate from the App Store catalog."
      />

      <div className="neo-panel mb-6 bg-white p-5">
        <h3 className="mb-3 text-base font-bold text-ink">How this works</h3>
        <div className="space-y-3 text-sm text-slate-600">
          <div className="flex gap-3">
            <span className="shrink-0 text-lg">📁</span>
            <p>
              <span className="font-semibold text-ink">Where to put apps:</span> each app needs its own folder
              inside <FolderName /> on the drive, containing the already-extracted program — its .exe and whatever
              files it needs alongside it. A <code className="rounded bg-slate-100 px-1 text-xs">.zip</code> archive
              or a <code className="rounded bg-slate-100 px-1 text-xs">Setup.exe</code> installer left un-extracted
              in that folder won't be picked up — only subfolders are scanned, loose files are ignored.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 text-lg">🔄</span>
            <p>
              <span className="font-semibold text-ink">Updates are manual:</span> Lockbox only detects and launches
              these apps — it never checks for or installs updates for them, since (unlike the App Store catalog or
              Lockbox itself) it has no record of where they came from. When a new version is released, download it
              yourself and replace the folder's contents.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 text-lg">🌐</span>
            <p>
              <span className="font-semibold text-ink">Where to find portable apps:</span>{" "}
              <button
                type="button"
                onClick={() =>
                  openUrl("https://portableapps.com/apps").catch((err) =>
                    console.error("Failed to open PortableApps.com", err),
                  )
                }
                className="font-semibold text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-700"
              >
                PortableApps.com
              </button>{" "}
              has a large directory of ready-to-run portable apps. For anything else, check the app's own official
              website for a "portable" or ".zip" download instead of its regular installer.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 text-lg">✅</span>
            <p>
              <span className="font-semibold text-ink">Nothing to set up by hand:</span> Lockbox creates{" "}
              <FolderName /> automatically the moment it runs — whether from a USB drive or a synced cloud folder —
              so there's no folder to create yourself first, portable or not.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>
      )}

      {loading ? (
        <p className="font-semibold text-slate-700">Scanning...</p>
      ) : apps.length === 0 ? (
        <div className="neo-card p-8 text-center font-semibold text-slate-600">
          No manually-added apps found yet. Copy a portable app's folder into "Third Party Apps\" on the drive to see
          it here.
        </div>
      ) : (
        <div className="neo-panel divide-y divide-slate-200 overflow-hidden bg-white">
          {apps.map((app) => (
            <div key={app.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink">{app.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {app.launcherPath ? app.launcherPath : "No executable found in this folder."}
                </p>
              </div>
              <ActionButton
                type="button"
                onClick={() => handleLaunch(app)}
                disabled={!app.launcherPath || launchingId === app.id}
                variant="primary"
              >
                {launchingId === app.id ? "Launching…" : "▶ Launch"}
              </ActionButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
