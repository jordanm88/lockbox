import { useEffect, useMemo, useState } from "react";
import type { VaultFileEntry } from "../lib/vaultBridge";

interface Props {
  entries: VaultFileEntry[];
  searchQuery?: string;
  onClearSearch?: () => void;
  onView: (entry: VaultFileEntry) => void;
  onDelete: (entry: VaultFileEntry) => void;
  onExport: (entry: VaultFileEntry) => void;
}

interface BrowserRow {
  fullPath: string;
  name: string;
  isDir: boolean;
  size: number;
  depth: number;
}

interface FileVisual {
  icon: string;
  bg: string;
  text: string;
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

// Colored file-type icons are the fastest visual cue that this is a real
// file browser (Drive/Dropbox/OneDrive all color-code by type) rather than a
// flat list — folders blue, docs blue, sheets green, media purple/pink, etc.
function fileVisual(name: string, isDir: boolean): FileVisual {
  if (isDir) return { icon: "📁", bg: "bg-blue-50", text: "text-blue-600" };

  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"].includes(ext)) {
    return { icon: "🖼️", bg: "bg-emerald-50", text: "text-emerald-600" };
  }
  if (ext === "pdf") return { icon: "📕", bg: "bg-red-50", text: "text-red-600" };
  if (["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)) {
    return { icon: "📄", bg: "bg-blue-50", text: "text-blue-600" };
  }
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) {
    return { icon: "📊", bg: "bg-green-50", text: "text-green-700" };
  }
  if (["ppt", "pptx", "odp"].includes(ext)) {
    return { icon: "📙", bg: "bg-orange-50", text: "text-orange-600" };
  }
  if (["zip", "7z", "rar", "tar", "gz", "xz"].includes(ext)) {
    return { icon: "🗜️", bg: "bg-amber-50", text: "text-amber-600" };
  }
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) {
    return { icon: "🎵", bg: "bg-purple-50", text: "text-purple-600" };
  }
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
    return { icon: "🎬", bg: "bg-pink-50", text: "text-pink-600" };
  }
  if (["js", "ts", "tsx", "jsx", "py", "rs", "json", "html", "css", "sh", "yml", "yaml"].includes(ext)) {
    return { icon: "🧩", bg: "bg-indigo-50", text: "text-indigo-600" };
  }
  return { icon: "📦", bg: "bg-slate-100", text: "text-slate-500" };
}

export default function VaultTreeView({ entries, searchQuery = "", onClearSearch, onView, onDelete, onExport }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  const isSearching = searchQuery.trim().length > 0;

  // Clicking a folder always has to leave "search results" mode — otherwise
  // the flat, whole-vault search view stays on screen and setCurrentPath
  // has no visible effect, which reads as "the folder won't open."
  function openFolder(path: string) {
    if (isSearching) onClearSearch?.();
    setCurrentPath(path);
  }
  const pathSet = useMemo(() => new Set(entries.filter((e) => e.isDir).map((e) => e.name)), [entries]);
  const currentLabel = currentPath ? currentPath.split("/")[currentPath.split("/").length - 1] ?? "Vault" : "My Vault";

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
    const query = searchQuery.trim().toLowerCase();
    const list: BrowserRow[] = [];

    for (const entry of entries) {
      if (isSearching) {
        // Search spans the whole vault, not just the current folder — same
        // as Drive/Dropbox's search behavior.
        const leaf = entry.name.includes("/") ? entry.name.slice(entry.name.lastIndexOf("/") + 1) : entry.name;
        if (!leaf.toLowerCase().includes(query)) continue;
        list.push({ fullPath: entry.name, name: entry.name, isDir: entry.isDir, size: entry.size, depth: 0 });
        continue;
      }

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
  }, [entries, currentPath, isSearching, searchQuery]);

  const crumbs = currentPath ? currentPath.split("/") : [];

  const rowEntryMap = useMemo(() => new Map(entries.map((e) => [e.name, e])), [entries]);
  const containingPath = currentPath ? parentPath(currentPath) : "";

  function formatSize(bytes: number): string {
    return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-ink">
                {isSearching ? `Search results for "${searchQuery.trim()}"` : currentLabel}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {rows.length} item{rows.length === 1 ? "" : "s"}
                {isSearching ? " found across the vault." : ". Open folders to drill down, or select a file to preview."}
              </p>
            </div>
            {!isSearching && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={`px-3.5 py-1.5 text-sm font-medium transition ${viewMode === "list" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    ☰ List
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={`px-3.5 py-1.5 text-sm font-medium transition ${viewMode === "grid" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    ⊞ Grid
                  </button>
                </div>
              </div>
            )}
          </div>

          {!isSearching && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
              <button type="button" onClick={() => setCurrentPath("")} className="rounded-full px-2 py-1 font-medium text-blue-600 hover:bg-blue-50">
                My Vault
              </button>
              {crumbs.map((crumb, index) => {
                const path = crumbs.slice(0, index + 1).join("/");
                return (
                  <div key={path} className="flex items-center gap-1.5">
                    <span className="text-slate-300">/</span>
                    <button
                      type="button"
                      onClick={() => setCurrentPath(path)}
                      className="rounded-full px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-blue-600"
                    >
                      {crumb}
                    </button>
                  </div>
                );
              })}
              {currentPath && (
                <button
                  type="button"
                  onClick={() => setCurrentPath(containingPath)}
                  className="ml-auto rounded-full px-3 py-1 font-medium text-slate-500 hover:bg-slate-100"
                >
                  ↑ Up one level
                </button>
              )}
            </div>
          )}
        </div>

        {viewMode === "list" || isSearching ? (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[minmax(0,1fr)_120px_110px_210px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <div>Name</div>
                <div>Type</div>
                <div className="text-right">Size</div>
                <div className="text-right">Actions</div>
              </div>

              {rows.length === 0 ? (
                <div className="px-5 py-14 text-center text-sm font-medium text-slate-500">
                  {isSearching ? "No files match your search." : "This folder is empty."}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const full = rowEntryMap.get(row.fullPath);
                    if (!full) return null;
                    const visual = fileVisual(row.name, row.isDir);

                    return (
                      <div
                        key={row.fullPath}
                        className="grid grid-cols-[minmax(0,1fr)_120px_110px_210px] items-center gap-4 px-5 py-3 transition hover:bg-slate-50"
                        style={{ paddingLeft: isSearching ? undefined : `${1.25 + Math.min(row.depth, 4) * 0.25}rem` }}
                      >
                        <button
                          type="button"
                          onClick={row.isDir ? () => openFolder(row.fullPath) : () => onView(full)}
                          className="flex min-w-0 items-center gap-3 text-left"
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${visual.bg} ${visual.text}`}>
                            {visual.icon}
                          </div>
                          <p className="truncate font-medium text-ink">{row.name}</p>
                        </button>

                        <div>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${visual.bg} ${visual.text}`}>
                            {row.isDir ? "Folder" : "File"}
                          </span>
                        </div>

                        <div className="text-right text-sm text-slate-500">{row.isDir ? "—" : formatSize(row.size)}</div>

                        <div className="flex items-center justify-end gap-2">
                          {row.isDir ? (
                            <button type="button" onClick={() => openFolder(row.fullPath)} className="rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
                              Open
                            </button>
                          ) : (
                            <button type="button" onClick={() => onView(full)} className="rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
                              View
                            </button>
                          )}
                          <button type="button" onClick={() => onExport(full)} className="rounded-full px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50">
                            Export
                          </button>
                          <button type="button" onClick={() => onDelete(full)} className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600">
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
        ) : (
          <div className="p-5">
            {rows.length === 0 ? (
              <div className="py-14 text-center text-sm font-medium text-slate-500">This folder is empty.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {rows.map((row) => {
                  const full = rowEntryMap.get(row.fullPath);
                  if (!full) return null;
                  const visual = fileVisual(row.name, row.isDir);

                  return (
                    <div key={row.fullPath} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                      <button
                        type="button"
                        onClick={row.isDir ? () => openFolder(row.fullPath) : () => onView(full)}
                        className="flex w-full flex-col items-center gap-3 text-center"
                      >
                        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-3xl ${visual.bg} ${visual.text}`}>
                          {visual.icon}
                        </div>
                        <p className="w-full truncate font-medium text-ink">{row.name}</p>
                        <p className="text-xs text-slate-400">{row.isDir ? "Folder" : formatSize(row.size)}</p>
                      </button>

                      <div className="mt-3 flex items-center justify-center gap-2">
                        {row.isDir ? (
                          <button type="button" onClick={() => openFolder(row.fullPath)} className="rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
                            Open
                          </button>
                        ) : (
                          <button type="button" onClick={() => onView(full)} className="rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
                            View
                          </button>
                        )}
                        <button type="button" onClick={() => onExport(full)} className="rounded-full px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50">
                          Export
                        </button>
                        <button type="button" onClick={() => onDelete(full)} className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
