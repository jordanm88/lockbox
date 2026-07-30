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
        <div className="flex flex-col gap-4 border-b border-slate-200/80 bg-gradient-to-r from-white to-slate-50 px-4 py-4 sm:px-5 sm:py-5">
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

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 font-medium text-slate-600">Folders first</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 font-medium text-slate-600">Click a folder to open</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 font-medium text-slate-600">Click a file to preview</span>
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

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 sm:p-5">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm font-medium text-slate-600 sm:col-span-full">
              This folder is empty.
            </div>
          ) : (
            rows.map((row) => {
              const full = rowEntryMap.get(row.fullPath);
              if (!full) return null;

              const tone = row.isDir
                ? "border-sky-200 bg-sky-50/70 hover:border-sky-300 hover:bg-sky-50"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
;

              return (
                <div
                  key={row.fullPath}
                  className={`group flex min-h-[172px] flex-col justify-between rounded-2xl border p-4 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-lg ${tone}`}
                  style={{ paddingLeft: `${1 + Math.min(row.depth, 4) * 0.5}rem` }}
                >
                  <button
                    type="button"
                    onClick={row.isDir ? () => setCurrentPath(row.fullPath) : () => onView(full)}
                    className="flex flex-1 flex-col items-start text-left"
                  >
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm ring-1 ring-slate-200">
                      {row.isDir ? "📁" : "📄"}
                    </div>
                    <p className="w-full truncate text-base font-semibold text-ink">{row.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{row.isDir ? "Folder" : `${row.size} bytes`}</p>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-500">
                      {row.isDir ? "Open to browse the contents inside." : "Open to preview the decrypted file in a focused viewer."}
                    </p>
                  </button>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.isDir ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>
                      {row.isDir ? "Folder" : "File"}
                    </span>
                    <div className="flex items-center gap-2">
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
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
