import { useEffect, useState } from "react";
import LockScreen from "./components/LockScreen";
import Sidebar from "./components/Sidebar";
import Vault from "./pages/Vault";
import AppStore from "./pages/AppStore";
import CloudSync from "./pages/CloudSync";
import Settings from "./pages/Settings";
import { lockVault, unlockVault } from "./lib/vaultBridge";
import { loadCloudConfig, syncVaultNow } from "./lib/cloudSyncBridge";
import { TabId } from "./types";

function readStoredBoolean(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("vault");

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(() => readStoredBoolean("autoSyncEnabled"));
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutesState] = useState(() =>
    readStoredNumber("autoSyncIntervalMinutes", 60),
  );
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);
  const [lastAutoSyncError, setLastAutoSyncError] = useState<string | null>(null);

  function setAutoSyncEnabled(next: boolean) {
    setAutoSyncEnabledState(next);
    try {
      localStorage.setItem("autoSyncEnabled", next ? "true" : "false");
    } catch {}
  }

  function setAutoSyncIntervalMinutes(next: number) {
    setAutoSyncIntervalMinutesState(next);
    try {
      localStorage.setItem("autoSyncIntervalMinutes", String(next));
    } catch {}
  }

  async function handleUnlock(passphrase: string): Promise<boolean> {
    const ok = await unlockVault(passphrase);
    if (ok) setUnlocked(true);
    return ok;
  }

  async function handleLock() {
    try {
      await lockVault();
    } catch (err) {
      console.error("Failed to clear vault key in backend", err);
    } finally {
      setUnlocked(false);
    }
  }

  // Lives here (not inside CloudSync) specifically so it keeps running no
  // matter which tab is active — CloudSync unmounts when you navigate away
  // from it, but App never does while the vault is unlocked.
  useEffect(() => {
    if (!unlocked || !autoSyncEnabled) return;

    let cancelled = false;
    const intervalMs = Math.max(1, autoSyncIntervalMinutes) * 60_000;

    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const config = await loadCloudConfig();
        if (!config) return; // nothing configured yet — skip quietly, not an error
        await syncVaultNow();
        if (!cancelled) {
          setLastAutoSyncAt(new Date().toISOString());
          setLastAutoSyncError(null);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Auto-sync failed.";
        // A sync already running (manual or a previous tick that overran the
        // interval) isn't a failure worth surfacing — just skip this tick.
        if (message.includes("already running")) return;
        setLastAutoSyncError(message);
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [unlocked, autoSyncEnabled, autoSyncIntervalMinutes]);

  if (!unlocked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="flex min-h-screen">
        <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} onLock={handleLock} />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            {activeTab === "vault" && <Vault />}
            {activeTab === "appstore" && <AppStore />}
            {activeTab === "cloudsync" && (
              <CloudSync
                autoSyncEnabled={autoSyncEnabled}
                onToggleAutoSync={setAutoSyncEnabled}
                autoSyncIntervalMinutes={autoSyncIntervalMinutes}
                onChangeAutoSyncInterval={setAutoSyncIntervalMinutes}
                lastAutoSyncAt={lastAutoSyncAt}
                lastAutoSyncError={lastAutoSyncError}
              />
            )}
            {activeTab === "settings" && <Settings onLock={handleLock} />}
          </div>
        </main>
      </div>
    </div>
  );
}
