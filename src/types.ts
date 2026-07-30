export type TabId = "vault" | "appstore" | "cloudsync" | "settings";

export interface NavItem {
  id: TabId;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "vault", label: "Vault", icon: "🔐" },
  { id: "appstore", label: "App Store", icon: "🛍️" },
  { id: "cloudsync", label: "Cloud Sync", icon: "☁️" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];
