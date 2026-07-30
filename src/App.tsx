import { useState } from "react";
import LockScreen from "./components/LockScreen";
import Sidebar from "./components/Sidebar";
import Vault from "./pages/Vault";
import AppStore from "./pages/AppStore";
import CloudSync from "./pages/CloudSync";
import Settings from "./pages/Settings";
import { lockVault, unlockVault } from "./lib/vaultBridge";
import { TabId } from "./types";

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("vault");

  async function handleUnlock(passphrase: string): Promise<boolean> {
    const ok = await unlockVault(passphrase);
    if (ok) setUnlocked(true);
    return ok;
  }

  async function handleLock() {
    try {
      await lockVault();
    } catch (err) {
      console.error("Failed to clear vault key in backend", err);
    } finally {
      setUnlocked(false);
    }
  }

  if (!unlocked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  return (
    <div className="flex">
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} onLock={handleLock} />
      <main className="min-h-screen flex-1 overflow-y-auto p-8">
        {activeTab === "vault" && <Vault />}
        {activeTab === "appstore" && <AppStore />}
        {activeTab === "cloudsync" && <CloudSync />}
        {activeTab === "settings" && <Settings onLock={handleLock} />}
      </main>
    </div>
  );
}
