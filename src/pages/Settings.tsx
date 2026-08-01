import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { AUTO_LOCK_OPTIONS, AutoLockOption } from "../types";
import { checkDriveEncryption, DriveEncryptionStatus } from "../lib/securityBridge";

interface SettingsProps {
  onLock: () => void;
  autoLockOption: AutoLockOption;
  onChangeAutoLockOption: (option: AutoLockOption) => void;
  autoUpdateEnabled: boolean;
  onChangeAutoUpdateEnabled: (enabled: boolean) => void;
  // Checking for an update never applies one — App.tsx owns the single
  // place that can do that, behind the Now/Later prompt. This button just
  // triggers a check; if one's found, the prompt appears over whichever tab
  // is open, not necessarily this one.
  onCheckForUpdateNow: () => void;
  checkingForUpdate: boolean;
  updateCheckStatus: string;
  lastUpdateCheckedAt: string | null;
}

export default function Settings({
  onLock,
  autoLockOption,
  onChangeAutoLockOption,
  autoUpdateEnabled,
  onChangeAutoUpdateEnabled,
  onCheckForUpdateNow,
  checkingForUpdate,
  updateCheckStatus,
  lastUpdateCheckedAt,
}: SettingsProps) {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const [driveStatus, setDriveStatus] = useState<DriveEncryptionStatus | null>(null);
  const [checkingDrive, setCheckingDrive] = useState(false);

  async function runDriveCheck() {
    setCheckingDrive(true);
    try {
      setDriveStatus(await checkDriveEncryption());
    } finally {
      setCheckingDrive(false);
    }
  }

  useEffect(() => {
    runDriveCheck();
  }, []);

  return (
    <div>
      <PageHeader icon="⚙️" title="Settings" subtitle="Vault passphrase and lock behavior." />

      <div className="neo-panel mb-6 bg-paper p-6">
        <h3 className="mb-1 text-xl font-semibold text-ink">Drive Encryption</h3>
        <p className="mb-4 text-sm text-slate-600">
          Lockbox only encrypts <span className="font-semibold">Vault/</span> — installed apps
          and their data under <span className="font-semibold">Apps/</span>,{" "}
          <span className="font-semibold">Third Party Apps/</span>, and{" "}
          <span className="font-semibold">Tools/</span> are ordinary plaintext files, since those
          programs need to read and write real files directly. Whole-drive encryption is what
          protects everything else if this drive is lost or stolen.
        </p>

        {checkingDrive && !driveStatus ? (
          <p className="text-sm font-medium text-slate-500">Checking…</p>
        ) : driveStatus?.protected === true ? (
          <div className="neo-card border-l-4 border-l-emerald-500 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-bold">✅ This drive is protected.</p>
            <p className="mt-1">{driveStatus.detail}</p>
          </div>
        ) : driveStatus?.protected === false ? (
          <div className="neo-card border-l-4 border-l-red-500 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-bold">⚠️ This drive isn't encrypted.</p>
            <p className="mt-1">{driveStatus.detail}</p>
            <p className="mt-3 font-semibold">To fix this:</p>
            <ul className="ml-5 list-disc space-y-1">
              <li>
                In File Explorer, right-click this drive and choose{" "}
                <span className="font-semibold">"Turn on BitLocker"</span> (Windows Pro,
                Enterprise, or Education).
              </li>
              <li>On Windows Home, use VeraCrypt instead — it's free and works on any edition.</li>
            </ul>
          </div>
        ) : (
          <div className="neo-card bg-paper p-4 text-sm text-slate-600">
            <p className="font-bold">ℹ️ Couldn't determine encryption status.</p>
            <p className="mt-1">{driveStatus?.detail ?? "Unknown error."}</p>
          </div>
        )}

        <button
          type="button"
          onClick={runDriveCheck}
          disabled={checkingDrive}
          className="neo-btn mt-4 bg-white px-4 py-2 text-sm"
        >
          {checkingDrive ? "Checking…" : "Re-check"}
        </button>
      </div>

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
              onClick={onCheckForUpdateNow}
              disabled={checkingForUpdate}
              className="neo-btn mt-3 w-full bg-neo-blue py-3 text-white"
            >
              {checkingForUpdate ? "Checking…" : "Update now"}
            </button>
            <p className="mt-3 text-sm text-slate-700">Status: {updateCheckStatus}</p>
            <p className="mt-1 text-xs text-slate-600">
              Last checked: {lastUpdateCheckedAt ? new Date(lastUpdateCheckedAt).toLocaleString() : "Never"}
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
