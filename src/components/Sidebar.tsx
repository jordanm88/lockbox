import { NAV_ITEMS, TabId } from "../types";

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  onLock: () => void;
}

export default function Sidebar({ activeTab, onSelectTab, onLock }: SidebarProps) {
  return (
    <aside className="flex min-h-screen w-72 shrink-0 flex-col border-r-4 border-ink bg-ink/95 text-white shadow-brutal">
      <div className="border-b-4 border-neo-yellow px-6 py-8">
        <div className="text-4xl">🔒</div>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-white">
          Lockbox
        </h1>
        <p className="mt-2 max-w-[14rem] text-sm font-bold text-white/70">
          Secure portable vault access for your drive.
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-2 px-4 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-3 rounded-sm border-2 border-transparent px-4 py-4 text-left font-black uppercase tracking-wide transition-all duration-150 ${
                isActive
                  ? "border-l-8 border-l-white bg-white text-ink shadow-brutal-sm"
                  : "text-white/85 hover:bg-white/10"
              }`}
            >
              <span className="text-2xl">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t-4 border-neo-yellow p-5">
        <button type="button" onClick={onLock} className="neo-btn w-full bg-neo-red py-3 text-white">
          🔒 Lock Vault
        </button>
      </div>
    </aside>
  );
}
