import { useEffect, useState } from "react";
import { getStorageInfo, StorageInfo } from "../lib/vaultBridge";

interface StorageMeterProps {
  /** Bump this after uploads/deletes to trigger a refetch. */
  refreshKey?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function StorageMeter({ refreshKey }: StorageMeterProps) {
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    let active = true;

    function refresh() {
      getStorageInfo()
        .then((result) => {
          if (active) setInfo(result);
        })
        .catch(() => {
          // Non-critical widget — fail quietly rather than showing an error
          // banner in the sidebar for something this cosmetic.
        });
    }

    refresh();
    // Self-polls so the meter stays reasonably fresh without every caller
    // needing to wire up a refresh signal after every upload/delete.
    const interval = setInterval(refresh, 20_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refreshKey]);

  if (!info) return null;

  const { vaultUsedBytes, driveTotalBytes } = info;
  const percent = driveTotalBytes ? Math.min(100, (vaultUsedBytes / driveTotalBytes) * 100) : null;
  const isNearFull = percent !== null && percent > 90;

  return (
    <div className="px-4 py-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Vault storage</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${isNearFull ? "bg-red-500" : "bg-blue-500"}`}
          style={{ width: `${percent ?? 6}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {formatBytes(vaultUsedBytes)}
        {driveTotalBytes ? ` of ${formatBytes(driveTotalBytes)} used` : " used on this drive"}
      </p>
    </div>
  );
}
