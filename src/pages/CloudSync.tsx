import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import {
  CloudRemoteConfig,
  RcloneOutputLine,
  loadCloudConfig,
  onRcloneOutput,
  onSyncFinished,
  saveCloudConfig,
  syncVaultNow,
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
      <span className="mb-1 block font-black uppercase">{label}</span>
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
    idle: { label: "Never synced", className: "bg-paper" },
    running: { label: "Syncing…", className: "bg-neo-yellow" },
    success: { label: "✓ Synced", className: "bg-neo-green" },
    failed: { label: "✗ Failed", className: "bg-neo-red text-white" },
  };
  const { label, className } = variants[status];
  return <span className={`neo-border px-3 py-1 text-sm font-black uppercase ${className}`}>{label}</span>;
}

export default function CloudSync() {
  const [config, setConfig] = useState<CloudRemoteConfig>(defaultConfigFor("s3"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [output, setOutput] = useState<string[]>([]);
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

    return () => {
      outputUnlisten.then((unlisten) => unlisten());
      finishedUnlisten.then((unlisten) => unlisten());
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
    setSyncStatus("running");
    setOutput([]);
    setError(null);
    try {
      await syncVaultNow();
      setSyncStatus("success");
    } catch (err) {
      setSyncStatus("failed");
      setError(err instanceof Error ? err.message : "Sync failed.");
    }
  }

  const isRunning = syncStatus === "running";

  return (
    <div>
      <PageHeader icon="☁️" title="Cloud Sync" subtitle="Back up an encrypted copy of the vault off-drive via rclone." />

      {error && (
        <p className="neo-card mb-6 bg-neo-red px-4 py-3 font-black uppercase text-white">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="neo-panel bg-paper p-6">
          <p className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-ink/75">Provider</p>
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
            <p className="font-black uppercase">Loading…</p>
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

              <button type="button" onClick={handleSave} disabled={saving} className="neo-btn mt-2 bg-neo-green py-3 text-white">
                {saving ? "Saving…" : saved ? "✓ Saved" : "💾 Save Connection"}
              </button>
            </div>
          )}
        </div>

        <div className="neo-panel flex flex-col bg-paper p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-ink/70">Status</p>
            <StatusBadge status={syncStatus} />
          </div>

          <button
            type="button"
            onClick={handleSync}
            disabled={isRunning || loading}
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
        </div>
      </div>
    </div>
  );
}
