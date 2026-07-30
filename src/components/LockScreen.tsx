import { FormEvent, useEffect, useState } from "react";
import { vaultExists } from "../lib/vaultBridge";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4">
      <form
        onSubmit={handleSubmit}
        className={`neo-panel w-full max-w-md border-neo-blue bg-paper p-8 ${shake ? "animate-shake" : ""}`}
      >
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-neo-blue text-4xl shadow-brutal">
            🔒
          </div>
          <h1 className="mt-4 text-4xl font-black uppercase tracking-tight text-ink">Lockbox</h1>
          <p className="mt-2 text-sm font-bold text-ink/70">{title}</p>
          <p className="mt-2 text-sm text-ink/60">{subtitle}</p>
        </div>

        {isLoading ? (
          <div className="neo-card rounded-sm border-4 border-ink bg-paper px-4 py-5 text-center font-black uppercase text-ink">
            Checking vault status…
          </div>
        ) : (
          <>
            <label htmlFor="passphrase" className="mb-2 block text-sm font-black uppercase tracking-[0.2em] text-ink/80">
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
                className="neo-input w-full px-4 py-3 text-lg"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase((value) => !value)}
                className="neo-btn shrink-0 rounded-sm bg-neo-yellow px-4 text-ink"
                aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
              >
                {showPassphrase ? "🙈" : "👁️"}
              </button>
            </div>

            {freshInstall && (
              <>
                <label htmlFor="confirm-passphrase" className="mt-4 block text-sm font-black uppercase tracking-[0.2em] text-ink/80">
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
                  className="neo-input w-full px-4 py-3 text-lg"
                />
              </>
            )}

            {error && (
              <p className="mt-4 rounded-sm border-4 border-ink bg-neo-red px-3 py-3 font-black uppercase text-white">
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
    </div>
  );
}
