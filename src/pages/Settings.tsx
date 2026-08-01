import { useState } from "react";
import PageHeader from "../components/PageHeader";
import { applyPortableUpdate, checkPortableUpdate } from "../lib/updateBridge";
import { getErrorMessage } from "../lib/errors";
import { AUTO_LOCK_OPTIONS, AutoLockOption } from "../types";
import pkg from "../../package.json";

interface SettingsProps {
  onLock: () => void;
  autoLockOption: AutoLockOption;
  onChangeAutoLockOption: (option: AutoLockOption) => void;
  autoUpdateEnabled: boolean;
  onChangeAutoUpdateEnabled: (enabled: boolean) => void;
}

export default function Settings({
  onLock,
  autoLockOption,
  onChangeAutoLockOption,
  autoUpdateEnabled,
  onChangeAutoUpdateEnabled,
}: SettingsProps) {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [updateStatus, setUpdateStatus] = useState<string>("Idle");
  const [updating, setUpdating] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem("lastUpdateCheckAt");
    } catch {
      return null;
    }
  });

  function recordLastChecked() {
    const now = new Date().toISOString();
    setLastCheckedAt(now);
    try {
      localStorage.setItem("lastUpdateCheckAt", now);
    } catch {}
  }

  async function runPortableUpdateCheck() {
    setUpdating(true);
    recordLastChecked();
    try {
      setUpdateStatus("Checking for updates...");
      const info = await checkPortableUpdate();
      if (!info.hasUpdate) {
        setUpdateStatus(`Up to date (${pkg.version})`);
        return;
      }

      if (!info.assetDownloadUrl) {
        setUpdateStatus(
          `Update found (${info.latestVersion}) but no Windows EXE asset was found in the latest release.`
        );
        return;
      }

      setUpdateStatus(`Downloading update ${info.latestVersion}...`);
      await applyPortableUpdate(info.assetDownloadUrl);
      setUpdateStatus("Applying update and restarting...");
    } catch (e) {
      const message = getErrorMessage(e, "Update check failed.");
      setUpdateStatus(`Update failed: ${message}`);
      console.debug("update check failed", e);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div>
      <PageHeader icon="⚙️" title="Settings" subtitle="Vault passphrase and lock behavior." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="neo-panel bg-paper p-6">
          <h3 className="mb-4 text-xl font-semibold text-ink">Change Passphrase</h3>
          <div className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Current Passphrase</span>
              <input
                type="password"
                value={currentPass}
                onChange={(event) => setCurrentPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">New Passphrase</span>
              <input
                type="password"
                value={newPass}
                onChange={(event) => setNewPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Confirm New Passphrase</span>
              <input
                type="password"
                value={confirmPass}
                onChange={(event) => setConfirmPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
          </div>
          <button type="button" className="neo-btn mt-6 w-full bg-neo-blue py-3 text-white">
            Update Passphrase
          </button>
        </div>

        <div className="neo-panel bg-paper p-6">
          <h3 className="mb-4 text-xl font-semibold text-ink">Lock Options</h3>
          <span className="mb-2 block text-sm font-semibold text-slate-700">Auto-Lock After Inactivity</span>
          <div className="grid grid-cols-2 gap-3">
            {AUTO_LOCK_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onChangeAutoLockOption(option)}
                className={`neo-btn py-3 ${autoLockOption === option ? "bg-blue-600 text-white" : "bg-paper"}`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <h3 className="mb-3 text-xl font-semibold text-ink">Danger Zone</h3>
            <button type="button" onClick={onLock} className="neo-btn w-full bg-neo-red py-3 text-white">
              🔒 Lock Vault Now
            </button>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="mb-3 text-xl font-semibold text-ink">Updates</h3>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-ink">Auto-check for updates</div>
                <div className="text-sm text-slate-600">
                  When enabled, Lockbox checks GitHub releases in the background and asks before
                  installing anything — choosing "Later" just asks again at the next check.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoUpdateEnabled}
                onClick={() => onChangeAutoUpdateEnabled(!autoUpdateEnabled)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${autoUpdateEnabled ? "bg-blue-600" : "bg-slate-200"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${autoUpdateEnabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>
            <button
              type="button"
              onClick={runPortableUpdateCheck}
              disabled={updating}
              className="neo-btn mt-3 w-full bg-neo-blue py-3 text-white"
            >
              {updating ? "Checking…" : "Update now"}
            </button>
            <p className="mt-3 text-sm text-slate-700">Status: {updateStatus}</p>
            <p className="mt-1 text-xs text-slate-600">
              Last checked: {lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : "Never"}
            </p>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="mb-3 text-xl font-semibold text-ink">Privacy Mode Transparency</h3>
            <div className="neo-card bg-paper p-4 text-sm text-slate-700">
              <p className="font-bold">Portable from USB (recommended):</p>
              <p>Lockbox stores Vault and Apps on the USB drive, not in your profile folders by design.</p>
              <p className="mt-2 font-bold">Expected host traces:</p>
              <p>Operating system execution logs, security scan metadata, and runtime cache artifacts may still exist on the host machine.</p>
              <p className="mt-2 font-bold">MSI install:</p>
              <p>Adds normal installer breadcrumbs such as uninstall entries, shortcuts, and installer metadata on the host.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
