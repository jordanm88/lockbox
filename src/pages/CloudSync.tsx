import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import {
  CloudRemoteConfig,
  RcloneOutputLine,
  loadCloudConfig,
  onRcloneOutput,
  onSyncFinished,
  onTestFinished,
  saveCloudConfig,
  syncVaultNow,
  testCloudConnection,
} from "../lib/cloudSyncBridge";

type Provider = CloudRemoteConfig["provider"];
type SyncStatus = "idle" | "running" | "success" | "failed";

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
    failed: { label: "✗ Failed", className: "bg-red-100 text-red-700" },
  };
  const { label, className } = variants[status];
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${className}`}>{label}</span>;
}

export default function CloudSync() {
  const [config, setConfig] = useState<CloudRemoteConfig>(defaultConfigFor("s3"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"idle" | "ok" | "failed">("idle");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [output, setOutput] = useState<string[]>([]);
  const [lastAction, setLastAction] = useState<"sync" | "test" | null>(null);
  const [lastErrorDetail, setLastErrorDetail] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCloudConfig()
      .then((existing) => {
        if (existing) setConfig(existing);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load cloud config."))
      .finally(() => setLoading(false));

    const outputUnlisten = onRcloneOutput((line: RcloneOutputLine) => {
      setOutput((current) => [...current, line.line]);
    });
    const finishedUnlisten = onSyncFinished((result) => {
      setSyncStatus(result.success ? "success" : "failed");
    });
    const testFinishedUnlisten = onTestFinished((result) => {
      setTesting(false);
      setTestResult(result.success ? "ok" : "failed");
    });

    return () => {
      outputUnlisten.then((unlisten) => unlisten());
      finishedUnlisten.then((unlisten) => unlisten());
      testFinishedUnlisten.then((unlisten) => unlisten());
    };
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
    setError(null);
    try {
      await saveCloudConfig(config);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cloud config.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setLastAction("sync");
    setSyncStatus("running");
    setOutput([]);
    setError(null);
    setLastErrorDetail(null);
    try {
      await syncVaultNow();
      setSyncStatus("success");
    } catch (err) {
      setSyncStatus("failed");
      const message = err instanceof Error ? err.message : "Sync failed.";
      setError(message);
      setLastErrorDetail(message);
    }
  }

  async function handleTestConnection() {
    setLastAction("test");
    setTesting(true);
    setTestResult("idle");
    setOutput([]);
    setError(null);
    setLastErrorDetail(null);
    try {
      await testCloudConnection(config);
      setTestResult("ok");
    } catch (err) {
      setTestResult("failed");
      const message = err instanceof Error ? err.message : "Connection test failed.";
      setError(message);
      setLastErrorDetail(message);
    } finally {
      setTesting(false);
    }
  }

  async function retryLastAction() {
    if (lastAction === "sync") {
      await handleSync();
      return;
    }
    if (lastAction === "test") {
      await handleTestConnection();
    }
  }

  const isRunning = syncStatus === "running";
  const busy = isRunning || testing || saving || loading;

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
            <span className="font-semibold text-ink"> Tools/win/rclone.exe</span> on Windows (or <span className="font-semibold text-ink">Tools/mac/rclone</span> / <span className="font-semibold text-ink">Tools/linux/rclone</span> on those platforms).
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
                onClick={handleTestConnection}
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
                    <button type="button" onClick={retryLastAction} disabled={busy} className="neo-btn mt-2 bg-neo-red px-3 py-2 text-white">
                      Retry {lastAction === "sync" ? "sync" : "connection test"}
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

          <button
            type="button"
            onClick={handleSync}
            disabled={busy}
            className="neo-btn mb-4 bg-neo-blue py-3 text-white"
          >
            {isRunning ? "Syncing…" : "🔄 Sync Vault Now"}
          </button>

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

          {output.length > 0 && (syncStatus === "failed" || testResult === "failed") && (
            <div className="neo-card mt-3 bg-white p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">Recent output details</p>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                {output.slice(-12).join("\n")}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
