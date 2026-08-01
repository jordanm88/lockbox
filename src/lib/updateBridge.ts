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

export interface ReleaseNotes {
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string | null;
}

export function getLatestRelease(): Promise<ReleaseInfo> {
  return invoke<ReleaseInfo>("get_latest_release", {});
}

/** Release notes for the version actually running right now — see the Rust command's doc comment for why this isn't just "the latest release." */
export function getCurrentReleaseNotes(): Promise<ReleaseNotes> {
  return invoke<ReleaseNotes>("get_current_release_notes");
}

export function checkPortableUpdate(): Promise<PortableUpdateInfo> {
  return invoke<PortableUpdateInfo>("check_portable_update", {});
}

export function applyPortableUpdate(downloadUrl: string): Promise<ApplyUpdateResult> {
  return invoke<ApplyUpdateResult>("apply_portable_update", { downloadUrl });
}
