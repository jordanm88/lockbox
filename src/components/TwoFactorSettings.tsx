import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import {
  beginTotpSetup,
  cancelTotpSetup,
  confirmTotpSetup,
  disableTotp,
  getTotpStatus,
} from "../lib/vaultBridge";
import { getErrorMessage } from "../lib/errors";
import ConfirmDialog from "./ConfirmDialog";

export default function TwoFactorSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);

  async function refresh() {
    try {
      setEnabled((await getTotpStatus()).enabled);
    } catch {
      // Vault likely locked mid-navigation — leave the last known state.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleStartSetup() {
    setError(null);
    setBusy(true);
    try {
      const setup = await beginTotpSetup();
      setSetupSecret(setup.secret);
      setQrDataUrl(await toDataURL(setup.otpauthUri));
    } catch (err) {
      setError(getErrorMessage(err, "Failed to start 2FA setup."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSetup() {
    setSetupSecret(null);
    setQrDataUrl(null);
    setCode("");
    setError(null);
    await cancelTotpSetup().catch(() => {});
  }

  async function handleConfirmSetup() {
    setError(null);
    setBusy(true);
    try {
      const ok = await confirmTotpSetup(code.trim());
      if (!ok) {
        setError("That code didn't match. Check your authenticator app and try again.");
        return;
      }
      setEnabled(true);
      setSetupSecret(null);
      setQrDataUrl(null);
      setCode("");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to confirm 2FA setup."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setDisableConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      await disableTotp();
      setEnabled(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to disable 2FA."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="neo-panel mb-6 bg-paper p-6">
      <h3 className="mb-1 text-xl font-semibold text-ink">Two-Factor Authentication</h3>
      <p className="mb-4 text-sm text-slate-500">
        Require a 6-digit code from an authenticator app (like Google Authenticator or Authy), in addition to your
        passphrase, to unlock this vault.
      </p>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3 py-3 text-sm font-semibold text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : setupSecret ? (
        <div className="flex flex-col items-center gap-4 text-center">
          {qrDataUrl && <img src={qrDataUrl} alt="2FA setup QR code" className="h-48 w-48 rounded-xl border border-slate-200" />}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Can't scan it?</p>
            <p className="mt-1 break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-ink">{setupSecret}</p>
          </div>
          <div className="w-full max-w-xs">
            <label htmlFor="totp-confirm-code" className="mb-1 block text-sm font-semibold text-slate-700">
              Enter the code from your app
            </label>
            <input
              id="totp-confirm-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="neo-input w-full px-4 py-2 text-center text-lg tracking-[0.4em]"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={handleCancelSetup} className="neo-btn px-4 py-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSetup}
              disabled={busy || code.length !== 6}
              className="neo-btn bg-neo-blue px-4 py-2 text-white disabled:opacity-60"
            >
              {busy ? "Confirming…" : "Confirm & Enable"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-ink">{enabled ? "2FA is enabled" : "2FA is off"}</div>
            <div className="text-sm text-slate-600">
              {enabled ? "You'll need a code from your authenticator app to unlock." : "Turn it on for an extra layer of protection."}
            </div>
          </div>
          {enabled ? (
            <button
              type="button"
              onClick={() => setDisableConfirmOpen(true)}
              disabled={busy}
              className="neo-btn shrink-0 bg-white px-4 py-2 text-red-600 disabled:opacity-60"
            >
              Disable 2FA
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartSetup}
              disabled={busy}
              className="neo-btn shrink-0 bg-neo-blue px-4 py-2 text-white disabled:opacity-60"
            >
              {busy ? "Starting…" : "Enable 2FA"}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={disableConfirmOpen}
        title="Disable two-factor authentication?"
        description="Unlocking this vault will only require your passphrase from now on."
        confirmLabel="Disable"
        onConfirm={handleDisable}
        onCancel={() => setDisableConfirmOpen(false)}
      />
    </div>
  );
}
