import { useEffect, useState } from "react";
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
        subtitle="Portable apps you copied onto the drive yourself, kept separate from the App Store catalog."
      />

      <p className="mb-6 text-sm text-slate-600">
        Apps you copy into <span className="font-semibold text-ink">Third Party Apps/</span> on the drive show up
        here automatically — Lockbox didn't download these and can't verify them, it just found them.
      </p>

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>
      )}

      {loading ? (
        <p className="font-semibold text-slate-700">Scanning...</p>
      ) : apps.length === 0 ? (
        <div className="neo-card p-8 text-center font-semibold text-slate-600">
          No manually-added apps found. Copy a portable app's folder into "Third Party Apps/" on the drive to see it
          here.
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
