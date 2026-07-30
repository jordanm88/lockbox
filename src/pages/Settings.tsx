import { useState } from "react";
import PageHeader from "../components/PageHeader";

const AUTO_LOCK_OPTIONS = ["1 minute", "5 minutes", "15 minutes", "Never"];

interface SettingsProps {
  onLock: () => void;
}

export default function Settings({ onLock }: SettingsProps) {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [autoLock, setAutoLock] = useState(AUTO_LOCK_OPTIONS[1]);

  return (
    <div>
      <PageHeader icon="⚙️" title="Settings" subtitle="Vault passphrase and lock behavior." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="neo-panel bg-paper p-6">
          <h3 className="mb-4 text-xl font-black uppercase">Change Passphrase</h3>
          <div className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1 block font-black uppercase">Current Passphrase</span>
              <input
                type="password"
                value={currentPass}
                onChange={(event) => setCurrentPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-black uppercase">New Passphrase</span>
              <input
                type="password"
                value={newPass}
                onChange={(event) => setNewPass(event.target.value)}
                className="neo-input w-full px-4 py-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-black uppercase">Confirm New Passphrase</span>
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
          <h3 className="mb-4 text-xl font-black uppercase">Lock Options</h3>
          <span className="mb-2 block font-black uppercase">Auto-Lock After Inactivity</span>
          <div className="grid grid-cols-2 gap-3">
            {AUTO_LOCK_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAutoLock(option)}
                className={`neo-btn py-3 ${autoLock === option ? "bg-neo-yellow" : "bg-paper"}`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mt-8 border-t-4 border-ink pt-6">
            <h3 className="mb-3 text-xl font-black uppercase">Danger Zone</h3>
            <button type="button" onClick={onLock} className="neo-btn w-full bg-neo-red py-3 text-white">
              🔒 Lock Vault Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
