import { FormEvent, useEffect, useState } from "react";
import { UnlockOutcome, vaultExists } from "../lib/vaultBridge";
import { getErrorMessage } from "../lib/errors";
import pkg from "../../package.json";

const CURRENT_YEAR = new Date().getFullYear();
// This is the single biggest lever over the vault's real-world security —
// Argon2id makes each guess expensive, but can't turn a short passphrase
// into a strong one. 12 is the widely-cited modern minimum (NIST SP 800-63B,
// OWASP) for a passphrase that's the sole credential protecting something,
// with no second factor and no recovery path. See docs/SECURITY.md.
const MIN_PASSPHRASE_LENGTH = 12;

interface LockScreenProps {
  onUnlock: (passphrase: string, totpCode?: string) => Promise<UnlockOutcome>;
  /** Shown once, e.g. "Locked automatically because the vault drive was removed." */
  notice?: string | null;
}

export default function LockScreen({ onUnlock, notice }: LockScreenProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freshInstall, setFreshInstall] = useState<boolean | null>(null);
  // Set once the passphrase step succeeds but the vault also has 2FA
  // enabled — the passphrase itself is kept in state (not re-asked) so the
  // second submit can resend it alongside the code.
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  useEffect(() => {
    let active = true;
    vaultExists()
      .then((exists) => {
        if (active) setFreshInstall(!exists);
      })
      .catch(() => {
        if (active) setFreshInstall(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function triggerError(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (freshInstall) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        triggerError(`Choose a passphrase with at least ${MIN_PASSPHRASE_LENGTH} characters.`);
        setBusy(false);
        return;
      }
      if (passphrase !== confirmPassphrase) {
        triggerError("Passphrases do not match.");
        setBusy(false);
        return;
      }
    }

    try {
      const outcome = await onUnlock(passphrase, needsTotp ? totpCode : undefined);
      switch (outcome.status) {
        case "unlocked":
          break;
        case "wrongPassphrase":
          setNeedsTotp(false);
          setTotpCode("");
          triggerError("Incorrect passphrase. Try again.");
          break;
        case "totpRequired":
          setNeedsTotp(true);
          break;
        case "wrongTotp":
          setTotpCode("");
          triggerError("That code didn't match. Try again.");
          break;
      }
    } catch (err) {
      triggerError(getErrorMessage(err, "Unable to reach the vault backend."));
    } finally {
      setBusy(false);
    }
  }

  const isLoading = freshInstall === null;
  const title = needsTotp ? "Enter your 2FA code" : freshInstall ? "Create your master passphrase" : "Enter your master passphrase";
  const subtitle = needsTotp
    ? "This vault has two-factor authentication enabled. Enter the 6-digit code from your authenticator app."
    : freshInstall
      ? "This is the first time Lockbox has run on this drive. Create a new master passphrase to protect your vault."
      : "Use the master passphrase you created earlier to unlock your vault.";
  const buttonText = needsTotp ? "Verify Code" : freshInstall ? "Create Master Passphrase" : "Unlock Vault";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-slate-950/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className={`neo-panel w-full max-w-md border-slate-200 bg-white p-8 ${shake ? "animate-shake" : ""}`}
      >
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-neo-blue text-4xl text-white shadow-brutal">
            🔒
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-ink">Lockbox</h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
              v{pkg.version}
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-700">{title}</p>
          <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
        </div>

        {notice && (
          <p className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
            {notice}
          </p>
        )}

        {isLoading ? (
          <div className="neo-card px-4 py-5 text-center font-semibold text-ink">
            Checking vault status…
          </div>
        ) : needsTotp ? (
          <>
            <label htmlFor="totp-code" className="mb-2 block text-sm font-semibold text-slate-700">
              Authenticator Code
            </label>
            <input
              id="totp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={totpCode}
              onChange={(event) => {
                setTotpCode(event.target.value.replace(/\D/g, ""));
                setError(null);
              }}
              placeholder="123456"
              className="neo-input w-full px-4 py-3 text-center text-2xl tracking-[0.5em]"
            />
            <button
              type="button"
              onClick={() => {
                setNeedsTotp(false);
                setTotpCode("");
                setError(null);
              }}
              className="mt-3 text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              ← Back to passphrase
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3 py-3 text-sm font-semibold text-red-700 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={totpCode.length !== 6 || busy}
              className="neo-btn mt-6 w-full bg-neo-blue py-3 text-lg text-white"
            >
              {busy ? "Verifying…" : buttonText}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="passphrase" className="mb-2 block text-sm font-semibold text-slate-700">
              Master Passphrase
            </label>
            {freshInstall && (
              <p className="mb-2 text-xs text-slate-500">
                At least {MIN_PASSPHRASE_LENGTH} characters — a short phrase is stronger than a
                shorter "complex" password. There's no recovery if you forget it.
              </p>
            )}
            <div className="flex gap-2">
              <input
                id="passphrase"
                type={showPassphrase ? "text" : "password"}
                autoFocus
                value={passphrase}
                onChange={(event) => {
                  setPassphrase(event.target.value);
                  setError(null);
                }}
                placeholder="••••••••••••"
                className="neo-input w-full px-4 py-3 text-base"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase((value) => !value)}
                className="neo-btn shrink-0 bg-white px-4 text-ink"
                aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
              >
                {showPassphrase ? "🙈" : "👁️"}
              </button>
            </div>

            {freshInstall && (
              <>
                <label htmlFor="confirm-passphrase" className="mt-4 block text-sm font-semibold text-slate-700">
                  Confirm Passphrase
                </label>
                <input
                  id="confirm-passphrase"
                  type={showPassphrase ? "text" : "password"}
                  value={confirmPassphrase}
                  onChange={(event) => {
                    setConfirmPassphrase(event.target.value);
                    setError(null);
                  }}
                  placeholder="••••••••••••"
                  className="neo-input w-full px-4 py-3 text-base"
                />
              </>
            )}

            {error && (
              <p className="mt-4 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3 py-3 text-sm font-semibold text-red-700 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={
                passphrase.length === 0 || busy || (freshInstall && confirmPassphrase.length === 0)
              }
              className="neo-btn mt-6 w-full bg-neo-blue py-3 text-lg text-white"
            >
              {busy ? (freshInstall ? "Creating…" : "Unlocking…") : buttonText}
            </button>
          </>
        )}
      </form>

      <div className="text-center text-xs text-white/60">
        <p>
          Designed &amp; engineered by{" "}
          <a
            href="https://jordan-mitchell.co.uk"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white/90 underline decoration-white/30 underline-offset-2 transition hover:text-white hover:decoration-white/70"
          >
            Jordan Mitchell ↗
          </a>
        </p>
        <p className="mt-1 text-white/40">
          © {CURRENT_YEAR} Jordan Mitchell. All rights reserved.
        </p>
      </div>
    </div>
  );
}
