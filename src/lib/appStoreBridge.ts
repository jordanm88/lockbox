import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  homepage: string | null;
  category: string | null;
  available: boolean;
  installed: boolean;
  launcherPath: string | null;
  sizeBytes: number | null;
  installKind: string | null;
}

export type InstallStage = "downloading" | "extracting" | "done";

export interface InstallProgressEvent {
  appId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  stage: InstallStage;
}

export function getAppCatalog(): Promise<CatalogEntry[]> {
  return invoke<CatalogEntry[]>("get_app_catalog");
}

export interface ThirdPartyApp {
  id: string;
  name: string;
  launcherPath: string | null;
}

/** Scans `Third Party Apps/` for apps the user copied in by hand. */
export function scanThirdPartyApps(): Promise<ThirdPartyApp[]> {
  return invoke<ThirdPartyApp[]>("scan_third_party_apps");
}

export function launchThirdPartyApp(appPath: string): Promise<void> {
  return invoke<void>("launch_third_party_app", { appPath });
}

export function installApp(appId: string): Promise<void> {
  return invoke<void>("install_app", { appId });
}

export function uninstallApp(appId: string): Promise<void> {
  return invoke<void>("uninstall_app", { appId });
}

export function launchPortableApp(appPath: string): Promise<void> {
  return invoke<void>("launch_portable_app", { appPath });
}

export function onInstallProgress(
  handler: (event: InstallProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<InstallProgressEvent>("app-install-progress", (event) => handler(event.payload));
}
