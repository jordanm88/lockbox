import { useEffect, useMemo, useState } from "react";
import type { VaultFileEntry } from "../lib/vaultBridge";

interface Props {
  entries: VaultFileEntry[];
  onView: (entry: VaultFileEntry) => void;
  onDelete: (entry: VaultFileEntry) => void;
}

interface BrowserRow {
  fullPath: string;
  name: string;
  isDir: boolean;
  size: number;
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export default function VaultTreeView({ entries, onView, onDelete }: Props) {
  const [currentPath, setCurrentPath] = useState("");

  const pathSet = useMemo(() => new Set(entries.filter((e) => e.isDir).map((e) => e.name)), [entries]);

  useEffect(() => {
    if (!currentPath) return;
    if (pathSet.has(currentPath)) return;

    // If folder was deleted/renamed, move to nearest existing parent.
    let fallback = parentPath(currentPath);
    while (fallback && !pathSet.has(fallback)) {
      fallback = parentPath(fallback);
    }
    setCurrentPath(fallback);
  }, [currentPath, pathSet]);

  const rows = useMemo(() => {
    const list: BrowserRow[] = [];
    for (const entry of entries) {
      if (parentPath(entry.name) !== currentPath) continue;
      const leaf = entry.name.includes("/") ? entry.name.slice(entry.name.lastIndexOf("/") + 1) : entry.name;
      list.push({
        fullPath: entry.name,
        name: leaf,
        isDir: entry.isDir,
        size: entry.size,
      });
    }
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [entries, currentPath]);

  const crumbs = currentPath ? currentPath.split("/") : [];

  const rowEntryMap = useMemo(() => new Map(entries.map((e) => [e.name, e])), [entries]);
  const containingPath = currentPath ? parentPath(currentPath) : "";

  return (
    <div className="space-y-3">
      <div className="neo-card flex flex-wrap items-center gap-2 p-3 text-sm">
        <button type="button" onClick={() => setCurrentPath("")} className="neo-btn px-3 py-1.5">
          Vault Root
        </button>
        {currentPath && (
          <button type="button" onClick={() => setCurrentPath(containingPath)} className="neo-btn px-3 py-1.5">
            Up one level
          </button>
        )}
        {crumbs.map((crumb, index) => {
          const path = crumbs.slice(0, index + 1).join("/");
          return (
            <div key={path} className="flex items-center gap-2">
              <span className="text-slate-500">/</span>
              <button type="button" onClick={() => setCurrentPath(path)} className="neo-btn px-3 py-1.5">
                {crumb}
              </button>
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="neo-panel p-6 text-center text-sm font-medium text-slate-600">This folder is empty.</div>
      ) : (
        rows.map((row) => {
          const full = rowEntryMap.get(row.fullPath);
          if (!full) return null;
          return (
            <div key={row.fullPath} className="neo-panel flex items-center gap-4 p-4">
              <span className="text-2xl">{row.isDir ? "📁" : "📄"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{row.name}</p>
                <p className="text-sm text-slate-600">{row.isDir ? "Folder" : `${row.size} bytes`}</p>
              </div>
              {row.isDir ? (
                <button type="button" onClick={() => setCurrentPath(row.fullPath)} className="neo-btn px-3 py-2">
                  Open
                </button>
              ) : (
                <button type="button" onClick={() => onView(full)} className="neo-btn px-3 py-2">
                  View
                </button>
              )}
              <button type="button" onClick={() => onDelete(full)} className="neo-btn bg-neo-red px-3 py-2 text-white">
                Delete
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
