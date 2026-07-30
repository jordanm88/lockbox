import { FormEvent, useState } from "react";

interface LockScreenProps {
  onUnlock: (passphrase: string) => Promise<boolean>;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  function triggerError(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const ok = await onUnlock(passphrase);
      if (ok) {
        setError(null);
      } else {
        triggerError("Incorrect passphrase. Try again.");
      }
    } catch (err) {
      triggerError(err instanceof Error ? err.message : "Unable to reach the vault backend.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4">
      <form
        onSubmit={handleSubmit}
        className={`neo-panel w-full max-w-md bg-neo-yellow p-8 ${shake ? "animate-shake" : ""}`}
      >
        <div className="mb-6 text-center">
          <div className="text-6xl">🔒</div>
          <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
            Lockbox
          </h1>
          <p className="mt-2 font-bold">
            Enter your master passphrase to unlock this vault.
          </p>
        </div>

        <label htmlFor="passphrase" className="mb-1 block font-black uppercase">
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
            className="neo-btn shrink-0 px-3"
            aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
          >
            {showPassphrase ? "🙈" : "👁️"}
          </button>
        </div>

        {error && (
          <p className="mt-3 border-4 border-ink bg-neo-red px-3 py-2 font-black uppercase text-white">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={passphrase.length === 0 || busy}
          className="neo-btn mt-6 w-full bg-neo-green py-3 text-lg"
        >
          {busy ? "Unlocking…" : "Unlock Vault"}
        </button>
      </form>
    </div>
  );
}
