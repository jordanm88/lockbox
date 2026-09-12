import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import AiAssistantSettings from "../components/AiAssistantSettings";
import TwoFactorSettings from "../components/TwoFactorSettings";
import { AUTO_LOCK_OPTIONS, AutoLockOption, TRASH_RETENTION_OPTIONS, TrashRetentionOption } from "../types";
import { checkDriveEncryption, DriveEncryptionStatus } from "../lib/securityBridge";
import {
  changePassphrase,
  clearVaultRootOverride,
  getPlatform,
  getVaultRoot,
  getVaultRootOverride,
  setVaultRootOverride,
  verifyVault,
  VaultVerifyReport,
} from "../lib/vaultBridge";
import { getEffectiveTheme, setTheme } from "../lib/theme";
import { passphraseStrengthBarColor, passphraseStrengthTextColor, scorePassphrase } from "../lib/passphraseStrength";
import { getErrorMessage } from "../lib/errors";

interface SettingsProps {
  onLock: () => void;
  autoLockOption: AutoLockOption;
  onChangeAutoLockOption: (option: AutoLockOption) => void;
  trashRetentionOption: TrashRetentionOption;
  onChangeTrashRetentionOption: (option: TrashRetentionOption) => void;
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
  onAiConfigChanged: () => void;
}

export default function Settings({
  onLock,
  autoLockOption,
  onChangeAutoLockOption,
  trashRetentionOption,
  onChangeTrashRetentionOption,
  autoUpdateEnabled,
  onChangeAutoUpdateEnabled,
  onCheckForUpdateNow,
  checkingForUpdate,
  updateCheckStatus,
  lastUpdateCheckedAt,
  onAiConfigChanged,
}: SettingsProps) {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [changingPassphrase, setChangingPassphrase] = useState(false);
  const [passphraseStatus, setPassphraseStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const passphraseStrength = scorePassphrase(newPass);

  const [verifying, setVerifying] = useState(false);
  const [verifyReport, setVerifyReport] = useState<VaultVerifyReport | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function handleVerifyVault() {
    setVerifying(true);
    setVerifyError(null);
    setVerifyReport(null);
    try {
      setVerifyReport(await verifyVault());
    } catch (err) {
      setVerifyError(getErrorMessage(err, "Failed to verify the vault."));
    } finally {
      setVerifying(false);
    }
  }

  async function handleChangePassphrase() {
    setPassphraseStatus(null);

    if (!currentPass || !newPass) {
      setPassphraseStatus({ kind: "error", text: "Enter your current and new passphrase." });
      return;
    }
    if (newPass !== confirmPass) {
      setPassphraseStatus({ kind: "error", text: "New passphrase and confirmation don't match." });
      return;
    }
    if (newPass === currentPass) {
      setPassphraseStatus({ kind: "error", text: "New passphrase must be different from the current one." });
      return;
    }

    setChangingPassphrase(true);
    try {
      await changePassphrase(currentPass, newPass);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      setPassphraseStatus({ kind: "ok", text: "Passphrase changed." });
    } catch (err) {
      setPassphraseStatus({
        kind: "error",
        text: getErrorMessage(err, "Failed to change passphrase."),
      });
    } finally {
      setChangingPassphrase(false);
    }
  }

  const [driveStatus, setDriveStatus] = useState<DriveEncryptionStatus | null>(null);
  const [checkingDrive, setCheckingDrive] = useState(false);
  const [platform, setPlatform] = useState<string | null>(null);
  const [vaultRoot, setVaultRoot] = useState<string | null>(null);
  const [vaultRootOverride, setVaultRootOverrideState] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(() => getEffectiveTheme() === "dark");

  function handleToggleDarkMode() {
    const next = !darkMode;
    setDarkMode(next);
    setTheme(next ? "dark" : "light");
  }
  const [changingLocation, setChangingLocation] = useState(false);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);

  async function runDriveCheck() {
    setCheckingDrive(true);
    try {
      setDriveStatus(await checkDriveEncryption());
    } finally {
      setCheckingDrive(false);
    }
  }

  function refreshVaultRootOverride() {
    getVaultRootOverride().then(setVaultRootOverrideState).catch(() => {});
  }

  useEffect(() => {
    runDriveCheck();
    getPlatform().then(setPlatform).catch(() => {});
    getVaultRoot().then(setVaultRoot).catch(() => {});
    refreshVaultRootOverride();
  }, []);

  async function handleChangeVaultLocation() {
    setLocationStatus(null);
    setChangingLocation(true);
    try {
      const picked = await setVaultRootOverride();
      if (picked) {
        setLocationStatus(
          `Vault location set to "${picked}". This takes effect the next time Lockbox starts — ` +
            "close and reopen it to switch. Nothing was moved: if that folder doesn't already " +
            "have a vault in it, Lockbox will start a brand new one there.",
        );
        refreshVaultRootOverride();
      }
    } catch (err) {
      setLocationStatus(getErrorMessage(err, "Failed to set the new vault location."));
    } finally {
      setChangingLocation(false);
    }
  }

  async function handleResetVaultLocation() {
    setLocationStatus(null);
    setChangingLocation(true);
    try {
      await clearVaultRootOverride();
      setLocationStatus("Reset to the default location. This takes effect next time Lockbox starts.");
      refreshVaultRootOverride();
    } catch (err) {
      setLocationStatus(getErrorMessage(err, "Failed to reset the vault location."));
    } finally {
      setChangingLocation(false);
    }
  }

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
          <div className="neo-card border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-800 dark:text-emerald-300">
            <p className="font-bold">✅ This drive is protected.</p>
            <p className="mt-1">{driveStatus.detail}</p>
          </div>
        ) : driveStatus?.protected === false ? (
          <div className="neo-card border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-300">
            <p className="font-bold">⚠️ This drive isn't encrypted.</p>
            <p className="mt-1">{driveStatus.detail}</p>
            <p className="mt-3 font-semibold">To fix this:</p>
            {platform === "linux" ? (
              <ul className="ml-5 list-disc space-y-1">
                <li>
                  LUKS encryption has to be set up when the drive is formatted — it can't be added
                  to a drive that's already in use without erasing it first. Back up the drive,
                  then re-create it with a tool like GNOME Disks or{" "}
                  <span className="font-semibold">cryptsetup luksFormat</span>.
                </li>
                <li>Restore the backed-up files onto the newly-encrypted drive afterward.</li>
              </ul>
            ) : (
              <ul className="ml-5 list-disc space-y-1">
                <li>
                  In File Explorer, right-click this drive and choose{" "}
                  <span className="font-semibold">"Turn on BitLocker"</span> (Windows Pro,
                  Enterprise, or Education).
                </li>
                <li>On Windows Home, use VeraCrypt instead — it's free and works on any edition.</li>
              </ul>
            )}
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

      <div className="neo-panel mb-6 bg-paper p-6">
        <h3 className="mb-1 text-xl font-semibold text-ink">Vault Integrity</h3>
        <p className="mb-4 text-sm text-slate-600">
          Confirms every file in the vault still has its encrypted data on disk and actually
          decrypts — catches corruption or a missing blob before you discover it by opening that
          file. Reads and decrypts everything in the vault, so it can take a while for a large one.
        </p>

        {verifyError && (
          <div className="neo-card border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-300">
            <p className="font-bold">⚠️ Verification failed to run.</p>
            <p className="mt-1">{verifyError}</p>
          </div>
        )}

        {verifyReport && (
          <div
            className={`neo-card p-4 text-sm ${
              verifyReport.broken.length === 0
                ? "border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                : "border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300"
            }`}
          >
            <p className="font-bold">
              {verifyReport.broken.length === 0
                ? `✅ All ${verifyReport.filesChecked} file(s) verified fine.`
                : `⚠️ ${verifyReport.broken.length} of ${verifyReport.filesChecked} file(s) have a problem.`}
            </p>
            {verifyReport.broken.length > 0 && (
              <ul className="ml-5 mt-2 list-disc space-y-1">
                {verifyReport.broken.map((issue) => (
                  <li key={issue.path}>
                    <span className="font-semibold">{issue.path}</span> — {issue.reason}
                  </li>
                ))}
              </ul>
            )}
            {verifyReport.orphanedBlobs.length > 0 && (
              <p className="mt-3 text-xs">
                Also found {verifyReport.orphanedBlobs.length} blob(s) on disk that nothing in the
                vault points to anymore — harmless leftovers, just unused space.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleVerifyVault}
          disabled={verifying}
          className="neo-btn mt-4 bg-white px-4 py-2 text-sm disabled:opacity-60"
        >
          {verifying ? "Verifying…" : "Verify Vault"}
        </button>
      </div>

      <TwoFactorSettings />
      <AiAssistantSettings onConfigChanged={onAiConfigChanged} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="neo-panel bg-paper p-6">
          <h3 className="mb-4 text-xl font-semibold text-ink">Change Passphrase</h3>
          <div className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Current Passphrase</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPass}
                onChange={(event) => setCurrentPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">New Passphrase</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPass}
                onChange={(event) => setNewPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
              {newPass && (
                <div className="mt-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i < passphraseStrength.score ? passphraseStrengthBarColor(passphraseStrength.score) : "bg-slate-200 dark:bg-slate-700"
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`mt-1 text-xs font-medium ${passphraseStrengthTextColor(passphraseStrength.score)}`}>
                    {passphraseStrength.label}
                  </p>
                </div>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Confirm New Passphrase</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPass}
                onChange={(event) => setConfirmPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
          </div>
          {passphraseStatus && (
            <p
              className={`mt-3 text-sm font-medium ${
                passphraseStatus.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {passphraseStatus.text}
            </p>
          )}
          <button
            type="button"
            onClick={handleChangePassphrase}
            disabled={changingPassphrase}
            className="neo-btn mt-6 w-full bg-neo-blue py-3 text-white disabled:opacity-60"
          >
            {changingPassphrase ? "Changing…" : "Update Passphrase"}
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

          <div className="mt-6 border-t border-slate-200 pt-4">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Trash Auto-Expiry</span>
            <p className="mb-2 text-xs text-slate-500">
              Items in Trash older than this are purged automatically, in addition to Empty Trash.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {TRASH_RETENTION_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChangeTrashRetentionOption(option)}
                  className={`neo-btn py-3 ${trashRetentionOption === option ? "bg-blue-600 text-white" : "bg-paper"}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-ink">Dark Mode</div>
                <div className="text-sm text-slate-600">
                  Follows your system by default until you switch it here.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={darkMode}
                onClick={handleToggleDarkMode}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${darkMode ? "bg-blue-600" : "bg-slate-200"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${darkMode ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>
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

          {vaultRoot && (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-xl font-semibold text-ink">Vault Location</h3>
              <p className="text-sm text-slate-600">
                {platform === "linux"
                  ? "Lockbox isn't installed as a portable exe on Linux, so it can't always " +
                    "default to a folder right next to itself — this is the folder it's using " +
                    "this session, found automatically, chosen on first run, or set below."
                  : "This is the folder Lockbox is using for its vault this session."}
              </p>
              <p className="neo-card mt-2 break-all bg-paper p-3 font-mono text-xs text-ink">
                {vaultRoot}
              </p>

              <p className="mt-4 text-sm text-slate-600">
                {vaultRootOverride
                  ? "A custom location is set (below), overriding the default."
                  : "Using the default location — no custom location is set."}{" "}
                Changing it does <span className="font-semibold">not</span> move any existing
                vault data: it only changes where Lockbox looks next time, so pick an empty
                folder only if you mean to start a brand new vault there. Takes effect after a
                restart, not immediately.
              </p>
              {vaultRootOverride && (
                <p className="neo-card mt-2 break-all bg-paper p-3 font-mono text-xs text-ink">
                  {vaultRootOverride}
                </p>
              )}

              {locationStatus && (
                <p className="mt-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
                  {locationStatus}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleChangeVaultLocation}
                  disabled={changingLocation}
                  className="neo-btn bg-white px-4 py-2 text-sm disabled:opacity-60"
                >
                  {changingLocation ? "Working…" : "Change Vault Location…"}
                </button>
                {vaultRootOverride && (
                  <button
                    type="button"
                    onClick={handleResetVaultLocation}
                    disabled={changingLocation}
                    className="neo-btn bg-white px-4 py-2 text-sm disabled:opacity-60"
                  >
                    Reset to Default
                  </button>
                )}
              </div>
            </div>
          )}

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
