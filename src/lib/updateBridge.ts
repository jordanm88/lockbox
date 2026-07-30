import { invoke } from "@tauri-apps/api/core";

export type ReleaseInfo = any;

export function getLatestRelease(): Promise<ReleaseInfo> {
  return invoke<ReleaseInfo>("get_latest_release", {});
}
