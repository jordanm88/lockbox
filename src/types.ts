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

export const AUTO_LOCK_OPTIONS = [
  "30 seconds",
  "1 minute",
  "2 minutes",
  "5 minutes",
  "10 minutes",
  "15 minutes",
  "30 minutes",
  "1 hour",
  "Never",
] as const;
export type AutoLockOption = (typeof AUTO_LOCK_OPTIONS)[number];

/** Minutes of inactivity before auto-lock fires; `null` means disabled. */
export const AUTO_LOCK_MINUTES: Record<AutoLockOption, number | null> = {
  "30 seconds": 0.5,
  "1 minute": 1,
  "2 minutes": 2,
  "5 minutes": 5,
  "10 minutes": 10,
  "15 minutes": 15,
  "30 minutes": 30,
  "1 hour": 60,
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
