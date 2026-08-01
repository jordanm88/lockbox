import { useState } from "react";
import { NAV_ITEMS, TabId } from "../types";
import StorageMeter from "./StorageMeter";
import ConfirmDialog from "./ConfirmDialog";
import { ejectUsbDrive } from "../lib/vaultBridge";
import { getErrorMessage } from "../lib/errors";

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  onLock: () => void;
}

export default function Sidebar({ activeTab, onSelectTab, onLock }: SidebarProps) {
  const [ejectConfirmOpen, setEjectConfirmOpen] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const [ejectStatus, setEjectStatus] = useState<string | null>(null);

  async function handleEject() {
    setEjectConfirmOpen(false);
    setEjecting(true);
    setEjectStatus(null);
    try {
      const result = await ejectUsbDrive();
      // Lockbox is about to close itself (see eject.rs), so this message
      // may only be visible for a moment — that's expected, not a bug.
      setEjectStatus(result.message);
    } catch (err) {
      setEjectStatus(getErrorMessage(err, "Failed to eject the drive."));
      setEjecting(false);
    }
  }

  return (
    // h-full + overflow-hidden pins the sidebar to exactly the viewport
    // height its flex parent gives it, regardless of window size; the nav
    // list scrolls internally (rather than the whole sidebar) if it's ever
    // taller than the available space, so the header and footer (lock
    // button, storage meter) stay pinned and visible.
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
      <div className="flex shrink-0 items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg text-white shadow-sm">
          🔒
        </div>
        <span className="text-lg font-bold tracking-tight text-ink">Lockbox</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-200">
        <StorageMeter />
        {ejectStatus && (
          <p className="mx-4 mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            {ejectStatus}
          </p>
        )}
        <div className="flex flex-col gap-2 px-4 pb-4 pt-1">
          <button
            type="button"
            onClick={onLock}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            🔒 Lock Vault
          </button>
          <button
            type="button"
            onClick={() => setEjectConfirmOpen(true)}
            disabled={ejecting}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-60"
          >
            {ejecting ? "Ejecting…" : "⏏ Eject USB"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={ejectConfirmOpen}
        title="Eject this drive?"
        description="Lockbox will lock the vault, clean up its own temp files, then close so the drive can be safely removed. Wait for Windows' removal notification before unplugging."
        confirmLabel="Eject"
        cancelLabel="Cancel"
        onConfirm={handleEject}
        onCancel={() => setEjectConfirmOpen(false)}
      />
    </aside>
  );
}
