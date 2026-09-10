export type TabId = "vault" | "appstore" | "thirdpartyapps" | "cloudsync" | "trash" | "settings";

export interface NavItem {
  id: TabId;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "vault", label: "Vault", icon: "🔐" },
  { id: "appstore", label: "App Store", icon: "🛍️" },
  { id: "thirdpartyapps", label: "Third Party Apps", icon: "📦" },
  { id: "cloudsync", label: "Cloud Sync", icon: "☁️" },
  { id: "trash", label: "Trash", icon: "🗑️" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export const AUTO_LOCK_OPTIONS = ["1 minute", "5 minutes", "15 minutes", "Never"] as const;
export type AutoLockOption = (typeof AUTO_LOCK_OPTIONS)[number];

/** Minutes of inactivity before auto-lock fires; `null` means disabled. */
export const AUTO_LOCK_MINUTES: Record<AutoLockOption, number | null> = {
  "1 minute": 1,
  "5 minutes": 5,
  "15 minutes": 15,
  Never: null,
};

export const TRASH_RETENTION_OPTIONS = ["7 days", "30 days", "90 days", "Never"] as const;
export type TrashRetentionOption = (typeof TRASH_RETENTION_OPTIONS)[number];

/** Days a trashed item is kept before auto-expiry purges it; `null` means disabled. */
export const TRASH_RETENTION_DAYS: Record<TrashRetentionOption, number | null> = {
  "7 days": 7,
  "30 days": 30,
  "90 days": 90,
  Never: null,
};
