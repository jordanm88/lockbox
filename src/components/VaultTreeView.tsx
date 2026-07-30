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
  depth: number;
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export default function VaultTreeView({ entries, onView, onDelete }: Props) {
  const [currentPath, setCurrentPath] = useState("");

  const pathSet = useMemo(() => new Set(entries.filter((e) => e.isDir).map((e) => e.name)), [entries]);
  const currentLabel = currentPath ? currentPath.split("/")[currentPath.split("/").length - 1] ?? "Vault" : "Vault";

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
        depth: entry.name === leaf ? 0 : entry.name.split("/").length - 1,
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
    <div className="space-y-4">
      <div className="neo-panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 bg-white px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Drive-style browser</p>
              <h3 className="mt-1 text-xl font-semibold text-ink">{currentLabel}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {rows.length} item{rows.length === 1 ? "" : "s"} in this folder. Open folders to drill down, or view files directly.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <button type="button" onClick={() => setCurrentPath("")} className="neo-btn px-3.5 py-2">
                Vault Root
              </button>
              {currentPath && (
                <button type="button" onClick={() => setCurrentPath(containingPath)} className="neo-btn px-3.5 py-2">
                  Up one level
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <button type="button" onClick={() => setCurrentPath("")} className="font-medium text-neo-blue hover:underline">
              Vault Root
            </button>
            {crumbs.map((crumb, index) => {
              const path = crumbs.slice(0, index + 1).join("/");
              return (
                <div key={path} className="flex items-center gap-2">
                  <span className="text-slate-400">/</span>
                  <button type="button" onClick={() => setCurrentPath(path)} className="font-medium text-slate-700 hover:text-neo-blue hover:underline">
                    {crumb}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_110px_160px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              <div>Name</div>
              <div>Type</div>
              <div className="text-right">Size</div>
              <div className="text-right">Actions</div>
            </div>

            {rows.length === 0 ? (
              <div className="px-5 py-14 text-center text-sm font-medium text-slate-600">This folder is empty.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {rows.map((row) => {
                  const full = rowEntryMap.get(row.fullPath);
                  if (!full) return null;

                  return (
                    <div
                      key={row.fullPath}
                      className={`grid grid-cols-[minmax(0,1fr)_120px_110px_160px] items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50 ${row.isDir ? "bg-sky-50/40" : "bg-white"}`}
                      style={{ paddingLeft: `${1.25 + Math.min(row.depth, 4) * 0.25}rem` }}
                    >
                      <button
                        type="button"
                        onClick={row.isDir ? () => setCurrentPath(row.fullPath) : () => onView(full)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${row.isDir ? "bg-sky-100 text-sky-700 ring-sky-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>
                          {row.isDir ? "📁" : "📄"}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{row.name}</p>
                          <p className="truncate text-sm text-slate-500">
                            {row.isDir ? "Open folder" : "Preview file"}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.isDir ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>
                          {row.isDir ? "Folder" : "File"}
                        </span>
                      </div>

                      <div className="text-right text-sm text-slate-600">
                        {row.isDir ? "—" : `${Math.max(1, Math.ceil(row.size / 1024))} KB`}
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        {row.isDir ? (
                          <button type="button" onClick={() => setCurrentPath(row.fullPath)} className="neo-btn px-3 py-2 text-sm">
                            Open
                          </button>
                        ) : (
                          <button type="button" onClick={() => onView(full)} className="neo-btn px-3 py-2 text-sm">
                            View
                          </button>
                        )}
                        <button type="button" onClick={() => onDelete(full)} className="neo-btn border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100">
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
