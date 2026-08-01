import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import ConfirmDialog from "../components/ConfirmDialog";
import { getErrorMessage } from "../lib/errors";
import {
  CloudAction,
  CloudRemoteConfig,
  loadCloudConfig,
  RestoreStatus,
  saveCloudConfig,
  SyncStatus,
  TestResult,
} from "../lib/cloudSyncBridge";

type Provider = CloudRemoteConfig["provider"];

interface CloudSyncProps {
  autoSyncEnabled: boolean;
  onToggleAutoSync: (next: boolean) => void;
  autoSyncIntervalMinutes: number;
  onChangeAutoSyncInterval: (next: number) => void;
  lastAutoSyncAt: string | null;
  lastAutoSyncError: string | null;
  // Owned by App.tsx (not local state here) so a sync/test/restore started
  // on this page — and the event listeners reporting its progress — keep
  // running, and stay visible via the global toast, no matter which tab you
  // switch to afterward. See the matching comment in App.tsx.
  syncStatus: SyncStatus;
  restoreStatus: RestoreStatus;
  testing: boolean;
  testResult: TestResult;
  output: string[];
  lastAction: CloudAction;
  lastErrorDetail: string | null;
  onSync: () => Promise<void>;
  onTest: (config: CloudRemoteConfig) => Promise<void>;
  onRestore: () => Promise<void>;
  onRetryLastAction: (config: CloudRemoteConfig) => Promise<void>;
}

const AUTO_SYNC_INTERVALS = [
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 6 hours", minutes: 360 },
  { label: "Once a day", minutes: 1440 },
];

const PROVIDERS: { id: Provider; label: string; icon: string }[] = [
  { id: "s3", label: "S3", icon: "🪣" },
  { id: "webdav", label: "WebDAV", icon: "🌐" },
  { id: "ftp", label: "FTP", icon: "📡" },
];

function defaultConfigFor(provider: Provider): CloudRemoteConfig {
  switch (provider) {
    case "s3":
      return {
        provider: "s3",
        endpoint: null,
        region: null,
        bucket: "",
        accessKeyId: "",
        secretAccessKey: "",
        remotePath: "",
      };
    case "webdav":
      return { provider: "webdav", url: "", username: "", password: "", remotePath: "" };
    case "ftp":
      return { provider: "ftp", host: "", port: null, username: "", password: "", remotePath: "" };
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="neo-input w-full px-4 py-2"
      />
    </label>
  );
}

function StatusBadge({ status }: { status: SyncStatus }) {
  const variants: Record<SyncStatus, { label: string; className: string }> = {
    idle: { label: "Never synced", className: "bg-slate-100 text-slate-600" },
    running: { label: "Syncing…", className: "bg-amber-100 text-amber-700" },
    success: { label: "✓ Synced", className: "bg-emerald-100 text-emerald-700" },
    skipped: { label: "⚠ Nothing to sync", className: "bg-amber-100 text-amber-700" },
    failed: { label: "✗ Failed", className: "bg-red-100 text-red-700" },
  };
  const { label, className } = variants[status];
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${className}`}>{label}</span>;
}

export default function CloudSync({
  autoSyncEnabled,
  onToggleAutoSync,
  autoSyncIntervalMinutes,
  onChangeAutoSyncInterval,
  lastAutoSyncAt,
  lastAutoSyncError,
  syncStatus,
  restoreStatus,
  testing,
  testResult,
  output,
  lastAction,
  lastErrorDetail,
  onSync,
  onTest,
  onRestore,
  onRetryLastAction,
}: CloudSyncProps) {
  const [config, setConfig] = useState<CloudRemoteConfig>(defaultConfigFor("s3"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCloudConfig()
      .then((existing) => {
        if (existing) setConfig(existing);
      })
      .catch((err) => setConfigError(getErrorMessage(err, "Failed to load cloud config.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [output]);

  function switchProvider(provider: Provider) {
    if (provider === config.provider) return;
    setConfig(defaultConfigFor(provider));
    setSaved(false);
  }

  function updateField(key: string, value: string) {
    setConfig((current) => ({ ...current, [key]: value }) as CloudRemoteConfig);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setConfigError(null);
    try {
      await saveCloudConfig(config);
      setSaved(true);
    } catch (err) {
      setConfigError(getErrorMessage(err, "Failed to save cloud config."));
    } finally {
      setSaving(false);
    }
  }

  function requestRestore() {
    setRestoreConfirmOpen(true);
  }

  async function handleRestore() {
    setRestoreConfirmOpen(false);
    await onRestore();
  }

  const error = configError ?? lastErrorDetail;
  const isRunning = syncStatus === "running";
  const isRestoring = restoreStatus === "running";
  const busy = isRunning || isRestoring || testing || saving || loading;

  return (
    <div>
      <PageHeader icon="☁️" title="Cloud Sync" subtitle="Back up an encrypted copy of the vault off-drive via rclone." />

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 text-sm font-semibold text-white">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="neo-panel bg-paper p-6">
          <p className="mb-3 text-sm font-semibold text-slate-600">Provider</p>
          <p className="mb-4 text-sm text-slate-600">
            Cloud sync uses a local <span className="font-semibold text-ink">rclone</span> binary from the USB drive. Put
            <span className="font-semibold text-ink"> Tools/rclone.exe</span> there — the packaging scripts do this for you automatically.
          </p>
          <div className="mb-6 flex flex-wrap gap-3">
            {PROVIDERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => switchProvider(option.id)}
                className={`neo-btn flex-1 min-w-[9rem] py-3 ${config.provider === option.id ? "bg-neo-blue text-white" : "bg-paper"}`}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="font-medium text-slate-700">Loading...</p>
          ) : (
            <div className="flex flex-col gap-4">
              {config.provider === "s3" && (
                <>
                  <Field label="Bucket" value={config.bucket} onChange={(v) => updateField("bucket", v)} placeholder="my-lockbox-backups" />
                  <Field
                    label="Custom Endpoint (optional)"
                    value={config.endpoint ?? ""}
                    onChange={(v) => setConfig((c) => ({ ...c, endpoint: v || null }) as CloudRemoteConfig)}
                    placeholder="https://s3.us-west-000.backblazeb2.com"
                  />
                  <Field
                    label="Region (optional)"
                    value={config.region ?? ""}
                    onChange={(v) => setConfig((c) => ({ ...c, region: v || null }) as CloudRemoteConfig)}
                    placeholder="us-east-1"
                  />
                  <Field label="Access Key ID" value={config.accessKeyId} onChange={(v) => updateField("accessKeyId", v)} />
                  <Field
                    label="Secret Access Key"
                    value={config.secretAccessKey}
                    onChange={(v) => updateField("secretAccessKey", v)}
                    type="password"
                  />
                  <Field label="Remote Path" value={config.remotePath} onChange={(v) => updateField("remotePath", v)} placeholder="backups/lockbox" />
                </>
              )}

              {config.provider === "webdav" && (
                <>
                  <Field
                    label="Server URL"
                    value={config.url}
                    onChange={(v) => updateField("url", v)}
                    placeholder="https://sync.example.com/remote.php/webdav"
                  />
                  <Field label="Username" value={config.username} onChange={(v) => updateField("username", v)} />
                  <Field label="Password" value={config.password} onChange={(v) => updateField("password", v)} type="password" />
                  <Field label="Remote Path" value={config.remotePath} onChange={(v) => updateField("remotePath", v)} placeholder="lockbox-backups" />
                </>
              )}

              {config.provider === "ftp" && (
                <>
                  <Field label="Host" value={config.host} onChange={(v) => updateField("host", v)} placeholder="ftp.example.com" />
                  <Field
                    label="Port (optional)"
                    value={config.port?.toString() ?? ""}
                    onChange={(v) => setConfig((c) => ({ ...c, port: v ? Number(v) : null }) as CloudRemoteConfig)}
                    placeholder="21"
                  />
                  <Field label="Username" value={config.username} onChange={(v) => updateField("username", v)} />
                  <Field label="Password" value={config.password} onChange={(v) => updateField("password", v)} type="password" />
                  <Field label="Remote Path" value={config.remotePath} onChange={(v) => updateField("remotePath", v)} placeholder="lockbox-backups" />
                </>
              )}

              <button type="button" onClick={handleSave} disabled={saving} className="neo-btn mt-2 bg-blue-600 py-3 text-white hover:bg-blue-700">
                {saving ? "Saving…" : saved ? "✓ Saved" : "💾 Save Connection"}
              </button>
              <button
                type="button"
                onClick={() => onTest(config)}
                disabled={busy}
                className="neo-btn bg-white py-3 text-slate-700"
              >
                {testing ? "Testing…" : "🧪 Test Connection"}
              </button>
              <p className="text-sm font-bold text-ink/70">
                {testResult === "ok"
                  ? "Connection OK"
                  : testResult === "failed"
                    ? "Connection failed"
                    : "Run a test to validate credentials and remote path."}
              </p>

              {lastErrorDetail && (
                <div className="neo-card bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-700">Last error: {lastErrorDetail}</p>
                  {lastAction && (
                    <button type="button" onClick={() => onRetryLastAction(config)} disabled={busy} className="neo-btn mt-2 bg-neo-red px-3 py-2 text-white">
                      Retry {lastAction === "sync" ? "sync" : lastAction === "restore" ? "restore" : "connection test"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="neo-panel flex flex-col bg-paper p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-600">Status</p>
            <StatusBadge status={syncStatus} />
          </div>
          {syncStatus === "skipped" && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Nothing was transferred — both the vault and the remote destination are empty, so
              there was nothing to copy. This is not the same as a completed backup.
            </p>
          )}

          <button
            type="button"
            onClick={onSync}
            disabled={busy}
            className="neo-btn mb-3 bg-neo-blue py-3 text-white"
          >
            {isRunning ? "Syncing…" : "🔄 Sync Vault Now"}
          </button>

          <button
            type="button"
            onClick={requestRestore}
            disabled={busy}
            className="neo-btn mb-2 bg-white py-3 text-slate-700"
          >
            {isRestoring ? "Restoring…" : "⬇ Restore from Backup"}
          </button>
          {restoreStatus !== "idle" && (
            <p
              className={`mb-4 text-xs font-medium ${restoreStatus === "success" ? "text-emerald-700" : restoreStatus === "failed" ? "text-red-700" : "text-slate-500"}`}
            >
              {restoreStatus === "running"
                ? "Pulling files down from the remote…"
                : restoreStatus === "success"
                  ? "✓ Restore complete. Files from the backup that were missing or newer locally have been copied in."
                  : "✗ Restore failed — see the error below."}
            </p>
          )}
          {restoreStatus === "idle" && (
            <p className="mb-4 text-xs text-slate-500">
              Copies files from the remote backup into the vault. Never deletes anything local —
              safe to use on a fresh drive or after local data loss.
            </p>
          )}

          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">Auto-sync</p>
                <p className="text-xs text-slate-500">
                  Runs in the background on this schedule while the vault is unlocked, no matter which tab is open.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSyncEnabled}
                onClick={() => onToggleAutoSync(!autoSyncEnabled)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${autoSyncEnabled ? "bg-blue-600" : "bg-slate-200"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${autoSyncEnabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>

            {autoSyncEnabled && (
              <div className="mt-3 space-y-2">
                <select
                  value={autoSyncIntervalMinutes}
                  onChange={(event) => onChangeAutoSyncInterval(Number(event.target.value))}
                  className="neo-input w-full px-3 py-2 text-sm"
                >
                  {AUTO_SYNC_INTERVALS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Last auto-sync: {lastAutoSyncAt ? new Date(lastAutoSyncAt).toLocaleString() : "Not yet run"}
                </p>
                {lastAutoSyncError && (
                  <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
                    Last auto-sync error: {lastAutoSyncError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div
            ref={outputRef}
            className="neo-border h-64 flex-1 overflow-y-auto bg-ink p-3 font-mono text-xs text-neo-green"
          >
            {output.length === 0 ? (
              <p className="text-white/40">rclone output will appear here…</p>
            ) : (
              output.map((line, index) => <div key={index}>{line}</div>)
            )}
          </div>

          {output.length > 0 && (syncStatus === "failed" || testResult === "failed" || restoreStatus === "failed") && (
            <div className="neo-card mt-3 bg-white p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">Recent output details</p>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                {output.slice(-12).join("\n")}
              </pre>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="Restore from backup?"
        description="This copies every file from the remote backup into the vault, overwriting any local file that shares the same name and path with the remote's version. Local-only files are left untouched — nothing is deleted."
        confirmLabel="Restore"
        cancelLabel="Cancel"
        onConfirm={handleRestore}
        onCancel={() => setRestoreConfirmOpen(false)}
      />
    </div>
  );
}
