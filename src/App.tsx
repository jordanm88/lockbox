import { useEffect, useState } from "react";
import LockScreen from "./components/LockScreen";
import Sidebar from "./components/Sidebar";
import Vault from "./pages/Vault";
import AppStore from "./pages/AppStore";
import ThirdPartyApps from "./pages/ThirdPartyApps";
import CloudSync from "./pages/CloudSync";
import Trash from "./pages/Trash";
import Settings from "./pages/Settings";
import ConfirmDialog from "./components/ConfirmDialog";
import UploadToast from "./components/UploadToast";
import CloudSyncToast from "./components/CloudSyncToast";
import WhatsNewDialog from "./components/WhatsNewDialog";
import {
  AiConfig,
  getAiConfig,
  lockVault,
  onVaultForceLocked,
  purgeExpiredTrash,
  UnlockOutcome,
  unlockVault,
} from "./lib/vaultBridge";
import ChatPopup from "./components/ChatPopup";
import {
  CloudAction,
  CloudRemoteConfig,
  loadCloudConfig,
  onRcloneOutput,
  onRestoreFinished,
  onSyncFinished,
  onTestFinished,
  RcloneOutputLine,
  restoreVaultFromCloud,
  RestoreStatus,
  syncVaultNow,
  SyncStatus,
  testCloudConnection,
  TestResult,
} from "./lib/cloudSyncBridge";
import {
  applyPortableUpdate,
  checkPortableUpdate,
  getCurrentReleaseNotes,
  PortableUpdateInfo,
  ReleaseNotes,
} from "./lib/updateBridge";
import { FileWithPath, runUpload, UploadProgressState } from "./lib/uploadManager";
import { getErrorMessage } from "./lib/errors";
import {
  AUTO_LOCK_MINUTES,
  AUTO_LOCK_OPTIONS,
  AutoLockOption,
  TabId,
  TRASH_RETENTION_DAYS,
  TRASH_RETENTION_OPTIONS,
  TrashRetentionOption,
} from "./types";
import pkg from "../package.json";

const LAST_SEEN_RELEASE_KEY = "lastSeenReleaseVersion";

// How often to re-check for updates in the background while the app stays
// open and unlocked. "Later" on the update prompt doesn't set its own timer
// — it just dismisses the prompt, and this interval (plus the immediate
// check on every unlock) is what re-surfaces it "at the next scheduled
// time," per the existing update-check design.
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

function readStoredAutoLockOption(): AutoLockOption {
  try {
    const stored = localStorage.getItem("autoLockOption");
    if (stored && (AUTO_LOCK_OPTIONS as readonly string[]).includes(stored)) {
      return stored as AutoLockOption;
    }
  } catch {}
  return "5 minutes";
}

function readStoredTrashRetentionOption(): TrashRetentionOption {
  try {
    const stored = localStorage.getItem("trashRetentionOption");
    if (stored && (TRASH_RETENTION_OPTIONS as readonly string[]).includes(stored)) {
      return stored as TrashRetentionOption;
    }
  } catch {}
  return "30 days";
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("vault");

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(() => readStoredBoolean("autoSyncEnabled"));
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutesState] = useState(() =>
    readStoredNumber("autoSyncIntervalMinutes", 60),
  );
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);
  const [lastAutoSyncError, setLastAutoSyncError] = useState<string | null>(null);

  // Lives here (not inside CloudSync) for the same reason uploads do —
  // starting a sync/test/restore from the Cloud Sync page shouldn't lose its
  // progress the moment you switch tabs. The event listeners below have to
  // live here too: CloudSync unmounting would otherwise unregister them,
  // silently dropping any output/finished event that arrives while you're
  // looking at a different page instead of just hiding it.
  const [cloudSyncStatus, setCloudSyncStatus] = useState<SyncStatus>("idle");
  const [cloudRestoreStatus, setCloudRestoreStatus] = useState<RestoreStatus>("idle");
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudTestResult, setCloudTestResult] = useState<TestResult>("idle");
  const [cloudOutput, setCloudOutput] = useState<string[]>([]);
  const [cloudLastAction, setCloudLastAction] = useState<CloudAction>(null);
  const [cloudLastErrorDetail, setCloudLastErrorDetail] = useState<string | null>(null);
  const [cloudToastDismissed, setCloudToastDismissed] = useState(false);

  // Lives here (not inside Vault) so an upload started on the Vault page
  // keeps running — and stays visible via the toast rendered below — no
  // matter which tab you switch to afterward, same reasoning as auto-sync
  // and auto-lock above.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);

  const [whatsNew, setWhatsNew] = useState<ReleaseNotes | null>(null);

  const [autoLockOption, setAutoLockOptionState] = useState<AutoLockOption>(readStoredAutoLockOption);

  function setAutoLockOption(next: AutoLockOption) {
    setAutoLockOptionState(next);
    try {
      localStorage.setItem("autoLockOption", next);
    } catch {}
  }

  const [trashRetentionOption, setTrashRetentionOptionState] = useState<TrashRetentionOption>(
    readStoredTrashRetentionOption,
  );

  function setTrashRetentionOption(next: TrashRetentionOption) {
    setTrashRetentionOptionState(next);
    try {
      localStorage.setItem("trashRetentionOption", next);
    } catch {}
  }

  const [autoUpdateEnabled, setAutoUpdateEnabledState] = useState(() => readStoredBoolean("autoUpdateEnabled"));
  const [updateAvailable, setUpdateAvailable] = useState<PortableUpdateInfo | null>(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updatePromptError, setUpdatePromptError] = useState<string | null>(null);
  const [manualCheckStatus, setManualCheckStatus] = useState("Idle");
  const [manualChecking, setManualChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem("lastUpdateCheckAt");
    } catch {
      return null;
    }
  });

  function setAutoUpdateEnabled(next: boolean) {
    setAutoUpdateEnabledState(next);
    try {
      localStorage.setItem("autoUpdateEnabled", next ? "true" : "false");
    } catch {}
  }

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

  async function startUpload(fileEntries: FileWithPath[], folderPaths: string[] = []) {
    if (fileEntries.length === 0 && folderPaths.length === 0) return;
    setUploading(true);
    try {
      const outcome = await runUpload(fileEntries, folderPaths, setUploadProgress);
      if (fileEntries.length === 0) {
        // Folder-only creation never emits byte progress, so there's no
        // prior state to build the "done" card on top of.
        setUploadProgress({
          completedFiles: 0,
          totalFiles: 0,
          completedBytes: 0,
          totalBytes: 0,
          currentFile: null,
          etaSeconds: null,
          status: "done",
          message: `Created ${outcome.folderCount} folder${outcome.folderCount === 1 ? "" : "s"}.`,
        });
      } else {
        setUploadProgress((current) =>
          current
            ? {
                ...current,
                status: "done",
                message:
                  outcome.renamed.length > 0
                    ? `Renamed to avoid overwriting: ${outcome.renamed.join(", ")}`
                    : undefined,
              }
            : current,
        );
      }
    } catch (err) {
      setUploadProgress((current) => ({
        completedFiles: current?.completedFiles ?? 0,
        totalFiles: current?.totalFiles ?? fileEntries.length,
        completedBytes: current?.completedBytes ?? 0,
        totalBytes: current?.totalBytes ?? 0,
        currentFile: null,
        etaSeconds: null,
        status: "error",
        message: getErrorMessage(err, "Upload failed."),
      }));
    } finally {
      setUploading(false);
    }
  }

  // Auto-dismiss the toast once an upload reaches a terminal state — errors
  // stay up longer than a plain success, since they're more likely to need
  // actually reading rather than just glancing at.
  useEffect(() => {
    if (!uploadProgress || uploadProgress.status === "uploading") return;
    const timer = setTimeout(() => setUploadProgress(null), uploadProgress.status === "error" ? 6000 : 2500);
    return () => clearTimeout(timer);
  }, [uploadProgress]);

  // Same auto-dismiss idea for the Cloud Sync toast, keyed off whichever of
  // sync/restore actually reached a terminal (non-running, non-idle) state.
  useEffect(() => {
    const syncDone = cloudLastAction === "sync" && cloudSyncStatus !== "running" && cloudSyncStatus !== "idle";
    const restoreDone = cloudLastAction === "restore" && cloudRestoreStatus !== "running" && cloudRestoreStatus !== "idle";
    if (!syncDone && !restoreDone) return;
    const isError = (syncDone && cloudSyncStatus === "failed") || (restoreDone && cloudRestoreStatus === "failed");
    const timer = setTimeout(() => setCloudToastDismissed(true), isError ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [cloudLastAction, cloudSyncStatus, cloudRestoreStatus]);

  async function handleUnlock(passphrase: string, totpCode?: string): Promise<UnlockOutcome> {
    const outcome = await unlockVault(passphrase, totpCode);
    if (outcome.status === "unlocked") {
      setUnlocked(true);
      setLockNotice(null);
    }
    return outcome;
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

  // Runs once per unlock (and again immediately if the retention setting
  // changes while already unlocked) rather than on a background timer —
  // there's no persistent process to run one in between app launches anyway.
  useEffect(() => {
    if (!unlocked) return;
    const days = TRASH_RETENTION_DAYS[trashRetentionOption];
    if (days === null) return;
    purgeExpiredTrash(days * 86_400).catch((err) => console.error("Failed to purge expired trash", err));
  }, [unlocked, trashRetentionOption]);

  // Drives whether the chat popup (below) is mounted at all. Settings calls
  // `refreshAiConfig` itself right after changing the enabled flag or the
  // API key, so the popup appears/disappears immediately rather than only
  // on the next unlock.
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);

  async function refreshAiConfig() {
    if (!unlocked) return;
    try {
      setAiConfig(await getAiConfig());
    } catch (err) {
      console.error("Failed to load AI assistant config", err);
      setAiConfig(null);
    }
  }

  useEffect(() => {
    if (!unlocked) {
      setAiConfig(null);
      return;
    }
    refreshAiConfig();
  }, [unlocked]);

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
        const message = getErrorMessage(err, "Auto-sync failed.");
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

  // Registered once, for the app's whole lifetime — not gated on `unlocked`
  // or tied to any cleanup beyond unmount, since these are just passive
  // setters with stable references. Re-registering them on every lock/unlock
  // cycle would risk a gap where an in-flight rclone process's output has
  // nowhere to land.
  useEffect(() => {
    const outputUnlisten = onRcloneOutput((line: RcloneOutputLine) => {
      setCloudOutput((current) => [...current, line.line]);
    });
    const syncFinishedUnlisten = onSyncFinished((result) => {
      setCloudSyncStatus(result.skipped ? "skipped" : result.success ? "success" : "failed");
    });
    const testFinishedUnlisten = onTestFinished((result) => {
      setCloudTesting(false);
      setCloudTestResult(result.success ? "ok" : "failed");
    });
    const restoreFinishedUnlisten = onRestoreFinished((result) => {
      setCloudRestoreStatus(result.success ? "success" : "failed");
    });
    // The backend's drive-removal watcher already clears the vault key in
    // memory by the time this fires (see lib.rs) — this just brings the UI
    // in line with that and explains why, instead of the vault silently
    // becoming unusable with no indication anything happened.
    const forceLockedUnlisten = onVaultForceLocked((reason) => {
      setLockNotice(reason);
      setUnlocked(false);
    });

    return () => {
      outputUnlisten.then((unlisten) => unlisten());
      syncFinishedUnlisten.then((unlisten) => unlisten());
      testFinishedUnlisten.then((unlisten) => unlisten());
      restoreFinishedUnlisten.then((unlisten) => unlisten());
      forceLockedUnlisten.then((unlisten) => unlisten());
    };
  }, []);

  async function triggerCloudSync() {
    setCloudLastAction("sync");
    setCloudSyncStatus("running");
    setCloudOutput([]);
    setCloudLastErrorDetail(null);
    setCloudToastDismissed(false);
    try {
      await syncVaultNow();
      setCloudSyncStatus("success");
    } catch (err) {
      setCloudSyncStatus("failed");
      setCloudLastErrorDetail(getErrorMessage(err, "Sync failed."));
    }
  }

  async function triggerCloudTest(config: CloudRemoteConfig) {
    setCloudLastAction("test");
    setCloudTesting(true);
    setCloudTestResult("idle");
    setCloudOutput([]);
    setCloudLastErrorDetail(null);
    try {
      await testCloudConnection(config);
      setCloudTestResult("ok");
    } catch (err) {
      setCloudTestResult("failed");
      setCloudLastErrorDetail(getErrorMessage(err, "Connection test failed."));
    } finally {
      setCloudTesting(false);
    }
  }

  async function triggerCloudRestore() {
    setCloudLastAction("restore");
    setCloudRestoreStatus("running");
    setCloudOutput([]);
    setCloudLastErrorDetail(null);
    setCloudToastDismissed(false);
    try {
      await restoreVaultFromCloud();
      setCloudRestoreStatus("success");
    } catch (err) {
      setCloudRestoreStatus("failed");
      setCloudLastErrorDetail(getErrorMessage(err, "Restore failed."));
    }
  }

  async function retryCloudLastAction(config: CloudRemoteConfig) {
    if (cloudLastAction === "sync") return triggerCloudSync();
    if (cloudLastAction === "test") return triggerCloudTest(config);
    if (cloudLastAction === "restore") return triggerCloudRestore();
  }

  // Locks the vault after N minutes with no mouse/keyboard/scroll activity
  // anywhere on the page. Lives here (not in Settings) for the same reason
  // auto-sync does — it has to keep running regardless of which tab is
  // open, since Settings unmounts the moment you navigate away from it.
  useEffect(() => {
    if (!unlocked) return;
    const minutes = AUTO_LOCK_MINUTES[autoLockOption];
    if (!minutes) return; // "Never"
    const lockAfterMs = minutes * 60_000;

    let timer: ReturnType<typeof setTimeout>;
    function resetTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        handleLock();
      }, lockAfterMs);
    }

    const activityEvents = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;
    activityEvents.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      activityEvents.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [unlocked, autoLockOption]);

  // Ctrl/Cmd+Shift+L: lock immediately, for when someone's walking up and
  // there's no time to click through the sidebar — a manual complement to
  // the automatic locks above (inactivity, drive removal). A modifier
  // chord, not a bare key, specifically so it still fires no matter what
  // has focus (an input, a button, nothing) rather than being swallowed the
  // way a bare keypress would be while typing — the same reasoning browsers
  // apply to their own Ctrl+S-style shortcuts. Shift is included (not just
  // Ctrl/Cmd+L) to stay clear of the browser/OS bindings some environments
  // already put on the bare combo.
  useEffect(() => {
    if (!unlocked) return;

    function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        handleLock();
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [unlocked]);

  // The one and only place that decides "an update was found" — used by
  // both the silent background timer below and the manual "Update now"
  // button in Settings, so neither path can ever apply an update without
  // going through the Now/Later prompt. There is deliberately no other way
  // to reach `setUpdateAvailable`.
  async function performUpdateCheck() {
    const info = await checkPortableUpdate();
    if (info.hasUpdate && info.assetDownloadUrl) {
      setUpdateAvailable(info);
    }
    return info;
  }

  function recordLastChecked() {
    const now = new Date().toISOString();
    setLastCheckedAt(now);
    try {
      localStorage.setItem("lastUpdateCheckAt", now);
    } catch {}
  }

  // Shows a one-time "what's new" popup the first time a new version of
  // Lockbox actually runs — compares the build's own version (not GitHub's
  // latest, which check_portable_update already handles separately) against
  // the last version this popup was shown for, stored on the host the same
  // way every other UI preference here is (autoLockOption, etc.).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      let lastSeen: string | null = null;
      try {
        lastSeen = localStorage.getItem(LAST_SEEN_RELEASE_KEY);
      } catch {}
      if (lastSeen === pkg.version) return;

      try {
        const notes = await getCurrentReleaseNotes();
        if (!cancelled) setWhatsNew(notes);
      } catch {
        // No tagged release for this exact version yet (a local dev build,
        // or the release just hasn't published), or no network — either
        // way this is a nice-to-have, not worth surfacing as an error.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  function dismissWhatsNew() {
    try {
      localStorage.setItem(LAST_SEEN_RELEASE_KEY, pkg.version);
    } catch {}
    setWhatsNew(null);
  }

  // Background update checks: immediately on unlock, then on a recurring
  // schedule. Lives here (not Settings) so the schedule keeps running
  // regardless of which tab is open, same reasoning as auto-sync/auto-lock.
  // Never applies automatically — finding an update just opens the
  // Now/Later prompt below; "Later" relies on this same effect firing again
  // to re-prompt rather than setting up any dismissal-specific timer.
  useEffect(() => {
    if (!unlocked || !autoUpdateEnabled) return;

    async function runBackgroundCheck() {
      recordLastChecked();
      try {
        await performUpdateCheck();
      } catch {
        // Silent in the background — the manual "Update now" button in
        // Settings surfaces the same error directly if checked by hand.
      }
    }

    runBackgroundCheck();
    const timer = setInterval(runBackgroundCheck, UPDATE_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [unlocked, autoUpdateEnabled]);

  async function handleManualUpdateCheck() {
    setManualChecking(true);
    recordLastChecked();
    setManualCheckStatus("Checking for updates…");
    try {
      const info = await performUpdateCheck();
      if (!info.hasUpdate) {
        setManualCheckStatus(`Up to date (v${info.currentVersion})`);
      } else if (!info.assetDownloadUrl) {
        setManualCheckStatus(
          `Update found (v${info.latestVersion}) but no matching release asset for this platform ` +
            "was found (the updater looks for the portable .exe on Windows, and the .deb or " +
            ".AppImage matching how this copy is running on Linux).",
        );
      } else {
        setManualCheckStatus(`Update v${info.latestVersion} available.`);
      }
    } catch (err) {
      setManualCheckStatus(`Update check failed: ${getErrorMessage(err, "unknown error")}`);
    } finally {
      setManualChecking(false);
    }
  }

  async function handleUpdateNow() {
    if (!updateAvailable?.assetDownloadUrl) return;
    setApplyingUpdate(true);
    setUpdatePromptError(null);
    try {
      await applyPortableUpdate(updateAvailable.assetDownloadUrl);
      // App closes and restarts itself from here — nothing more to do.
    } catch (err) {
      setUpdatePromptError(getErrorMessage(err, "Update failed."));
      setApplyingUpdate(false);
    }
  }

  function handleUpdateLater() {
    setUpdateAvailable(null);
    setUpdatePromptError(null);
  }

  if (!unlocked) {
    return <LockScreen onUnlock={handleUnlock} notice={lockNotice} />;
  }

  return (
    // Fixed to the viewport height (not min-h-screen) so the sidebar and
    // main content scroll independently instead of the whole page scrolling
    // together — otherwise a tall page pushes the sidebar itself off-screen.
    <div className="flex h-screen overflow-hidden bg-transparent">
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} onLock={handleLock} />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="mx-auto w-full max-w-7xl">
          {activeTab === "vault" && <Vault uploading={uploading} onStartUpload={startUpload} />}
          {activeTab === "appstore" && <AppStore />}
          {activeTab === "thirdpartyapps" && <ThirdPartyApps />}
          {activeTab === "cloudsync" && (
            <CloudSync
              autoSyncEnabled={autoSyncEnabled}
              onToggleAutoSync={setAutoSyncEnabled}
              autoSyncIntervalMinutes={autoSyncIntervalMinutes}
              onChangeAutoSyncInterval={setAutoSyncIntervalMinutes}
              lastAutoSyncAt={lastAutoSyncAt}
              lastAutoSyncError={lastAutoSyncError}
              syncStatus={cloudSyncStatus}
              restoreStatus={cloudRestoreStatus}
              testing={cloudTesting}
              testResult={cloudTestResult}
              output={cloudOutput}
              lastAction={cloudLastAction}
              lastErrorDetail={cloudLastErrorDetail}
              onSync={triggerCloudSync}
              onTest={triggerCloudTest}
              onRestore={triggerCloudRestore}
              onRetryLastAction={retryCloudLastAction}
            />
          )}
          {activeTab === "trash" && <Trash />}
          {activeTab === "settings" && (
            <Settings
              onLock={handleLock}
              autoLockOption={autoLockOption}
              onChangeAutoLockOption={setAutoLockOption}
              trashRetentionOption={trashRetentionOption}
              onChangeTrashRetentionOption={setTrashRetentionOption}
              autoUpdateEnabled={autoUpdateEnabled}
              onChangeAutoUpdateEnabled={setAutoUpdateEnabled}
              onCheckForUpdateNow={handleManualUpdateCheck}
              checkingForUpdate={manualChecking}
              updateCheckStatus={manualCheckStatus}
              lastUpdateCheckedAt={lastCheckedAt}
              onAiConfigChanged={refreshAiConfig}
            />
          )}
        </div>
      </main>

      <ConfirmDialog
        open={updateAvailable !== null}
        title={updateAvailable ? `Update available: v${updateAvailable.latestVersion}` : "Update available"}
        description={
          updatePromptError
            ? `Update failed: ${updatePromptError}`
            : applyingUpdate
              ? "Downloading update…"
              : `You're on v${updateAvailable?.currentVersion}. Update now, or choose Later and Lockbox will ask again next time it checks.`
        }
        confirmLabel={applyingUpdate ? "Updating…" : "Update Now"}
        cancelLabel="Later"
        onConfirm={handleUpdateNow}
        onCancel={handleUpdateLater}
      />

      <UploadToast progress={uploadProgress} onDismiss={() => setUploadProgress(null)} />

      {!cloudToastDismissed && (
        <CloudSyncToast
          lastAction={cloudLastAction}
          syncStatus={cloudSyncStatus}
          restoreStatus={cloudRestoreStatus}
          lastErrorDetail={cloudLastErrorDetail}
          latestOutputLine={cloudOutput.length > 0 ? cloudOutput[cloudOutput.length - 1] : null}
          onDismiss={() => setCloudToastDismissed(true)}
        />
      )}

      <WhatsNewDialog release={whatsNew} onDismiss={dismissWhatsNew} />

      {unlocked && aiConfig?.enabled && aiConfig.hasApiKey && <ChatPopup />}
    </div>
  );
}
