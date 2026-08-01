import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type CloudRemoteConfig =
  | {
      provider: "s3";
      endpoint: string | null;
      region: string | null;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      remotePath: string;
    }
  | {
      provider: "webdav";
      url: string;
      username: string;
      password: string;
      remotePath: string;
    }
  | {
      provider: "ftp";
      host: string;
      port: number | null;
      username: string;
      password: string;
      remotePath: string;
    };

export type SyncStatus = "idle" | "running" | "success" | "skipped" | "failed";
export type RestoreStatus = "idle" | "running" | "success" | "failed";
export type TestResult = "idle" | "ok" | "failed";
export type CloudAction = "sync" | "test" | "restore" | null;

export interface RcloneOutputLine {
  stream: "stdout" | "stderr";
  line: string;
}

export interface SyncFinished {
  success: boolean;
  code: number | null;
  /** True when nothing was transferred because the vault and remote were both empty. */
  skipped: boolean;
}

export interface TestFinished {
  success: boolean;
  code: number | null;
}

export interface RestoreFinished {
  success: boolean;
  code: number | null;
}

export function saveCloudConfig(config: CloudRemoteConfig): Promise<void> {
  return invoke<void>("save_cloud_config", { config });
}

export function loadCloudConfig(): Promise<CloudRemoteConfig | null> {
  return invoke<CloudRemoteConfig | null>("load_cloud_config");
}

export function syncVaultNow(): Promise<void> {
  return invoke<void>("sync_vault_now");
}

/**
 * Pulls the cloud backup back down into the vault (`rclone copy`, additive
 * only — never deletes local-only files). Use when restoring onto a fresh
 * drive or recovering from local data loss.
 */
export function restoreVaultFromCloud(): Promise<void> {
  return invoke<void>("restore_vault_from_cloud");
}

export function testCloudConnection(config: CloudRemoteConfig): Promise<void> {
  return invoke<void>("test_cloud_connection", { config });
}

export function onRcloneOutput(handler: (line: RcloneOutputLine) => void): Promise<UnlistenFn> {
  return listen<RcloneOutputLine>("rclone-output", (event) => handler(event.payload));
}

export function onSyncFinished(handler: (result: SyncFinished) => void): Promise<UnlistenFn> {
  return listen<SyncFinished>("rclone-sync-finished", (event) => handler(event.payload));
}

export function onRestoreFinished(handler: (result: RestoreFinished) => void): Promise<UnlistenFn> {
  return listen<RestoreFinished>("rclone-restore-finished", (event) => handler(event.payload));
}

export function onTestFinished(handler: (result: TestFinished) => void): Promise<UnlistenFn> {
  return listen<TestFinished>("rclone-test-finished", (event) => handler(event.payload));
}
