import { NAV_ITEMS, TabId } from "../types";

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  onLock: () => void;
}

export default function Sidebar({ activeTab, onSelectTab, onLock }: SidebarProps) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r-4 border-ink bg-ink">
      <div className="border-b-4 border-neo-yellow px-6 py-6">
        <div className="text-3xl">🔒</div>
        <h1 className="mt-1 text-2xl font-black uppercase tracking-tight text-white">
          Lockbox
        </h1>
      </div>

      <nav className="flex flex-1 flex-col">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-3 border-b-4 border-ink px-6 py-5 text-left font-black uppercase tracking-wide transition-colors ${
                isActive
                  ? "border-l-8 border-l-white bg-neo-yellow text-ink"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <span className="text-2xl">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t-4 border-neo-yellow p-4">
        <button type="button" onClick={onLock} className="neo-btn w-full bg-neo-red py-3 text-white">
          🔒 Lock Vault
        </button>
      </div>
    </aside>
  );
}
