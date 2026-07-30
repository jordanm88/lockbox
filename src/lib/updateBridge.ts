import { invoke } from "@tauri-apps/api/core";

export type ReleaseInfo = any;

export interface PortableUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string | null;
  assetName: string | null;
  assetDownloadUrl: string | null;
}

export interface ApplyUpdateResult {
  started: boolean;
  message: string;
}

export function getLatestRelease(): Promise<ReleaseInfo> {
  return invoke<ReleaseInfo>("get_latest_release", {});
}

export function checkPortableUpdate(): Promise<PortableUpdateInfo> {
  return invoke<PortableUpdateInfo>("check_portable_update", {});
}

export function applyPortableUpdate(downloadUrl: string): Promise<ApplyUpdateResult> {
  return invoke<ApplyUpdateResult>("apply_portable_update", { downloadUrl });
}
