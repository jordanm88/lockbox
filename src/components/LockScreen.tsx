import { FormEvent, useEffect, useState } from "react";
import { vaultExists } from "../lib/vaultBridge";
import pkg from "../../package.json";

const CURRENT_YEAR = new Date().getFullYear();

interface LockScreenProps {
  onUnlock: (passphrase: string) => Promise<boolean>;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freshInstall, setFreshInstall] = useState<boolean | null>(null);

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
      if (passphrase.length < 8) {
        triggerError("Choose a passphrase with at least 8 characters.");
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
      const ok = await onUnlock(passphrase);
      if (!ok) {
        triggerError("Incorrect passphrase. Try again.");
      }
    } catch (err) {
      triggerError(err instanceof Error ? err.message : "Unable to reach the vault backend.");
    } finally {
      setBusy(false);
    }
  }

  const isLoading = freshInstall === null;
  const title = freshInstall ? "Create your master passphrase" : "Enter your master passphrase";
  const subtitle = freshInstall
    ? "This is the first time Lockbox has run on this drive. Create a new master passphrase to protect your vault."
    : "Use the master passphrase you created earlier to unlock your vault.";
  const buttonText = freshInstall ? "Create Master Passphrase" : "Unlock Vault";

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

        {isLoading ? (
          <div className="neo-card px-4 py-5 text-center font-semibold text-ink">
            Checking vault status…
          </div>
        ) : (
          <>
            <label htmlFor="passphrase" className="mb-2 block text-sm font-semibold text-slate-700">
              Master Passphrase
            </label>
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
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm font-semibold text-red-700">
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
