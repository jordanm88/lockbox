import { useMemo } from "react";
import type { VaultFileEntry } from "../lib/vaultBridge";
import { isVideoFile } from "../lib/fileKind";

interface VideosGridProps {
  entries: VaultFileEntry[];
  searchQuery?: string;
  selectedPaths: Set<string>;
  onToggleSelect: (fullPath: string) => void;
  onSetSelection: (paths: string[]) => void;
  onView: (entry: VaultFileEntry) => void;
  onExport: (entry: VaultFileEntry) => void;
  onDelete: (entry: VaultFileEntry) => void;
  onBulkExport: () => void;
  onBulkDelete: () => void;
}

function leafName(path: string): string {
  return path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
}

function parentFolder(path: string): string | null {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Unlike Pictures, tiles here never decrypt anything up front — a video can
// easily be hundreds of MB to several GB, and generating a real thumbnail
// would need to decode a frame out of it (no ffmpeg or similar decoder is
// bundled). Each tile is just a static icon + metadata; the actual decrypt
// only happens once, on demand, when you click to play it — same as the
// main vault's "View" action already does for any file.
export default function VideosGrid({
  entries,
  searchQuery = "",
  selectedPaths,
  onToggleSelect,
  onSetSelection,
  onView,
  onExport,
  onDelete,
  onBulkExport,
  onBulkDelete,
}: VideosGridProps) {
  const videos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return entries
      .filter((entry) => !entry.isDir && isVideoFile(entry.name))
      .filter((entry) => !query || leafName(entry.name).toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, searchQuery]);

  const visiblePaths = useMemo(() => videos.map((v) => v.name), [videos]);
  const allVisibleSelected = visiblePaths.length > 0 && visiblePaths.every((path) => selectedPaths.has(path));

  function toggleSelectAllVisible() {
    onSetSelection(allVisibleSelected ? [] : visiblePaths);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-xl font-semibold text-ink">
            {searchQuery.trim() ? `Search results for "${searchQuery.trim()}"` : "Videos"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {videos.length} video{videos.length === 1 ? "" : "s"} found across your vault.
          </p>
        </div>
        {videos.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              className="h-4 w-4 rounded border-slate-300"
            />
            Select all
          </label>
        )}
      </div>

      {selectedPaths.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-blue-100 bg-blue-50 px-5 py-3">
          <p className="text-sm font-semibold text-blue-800">
            {selectedPaths.size} item{selectedPaths.size === 1 ? "" : "s"} selected
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onBulkExport}
              className="rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50"
            >
              ⬇ Export selected
            </button>
            <button
              type="button"
              onClick={onBulkDelete}
              className="rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
            >
              🗑 Delete selected
            </button>
            <button
              type="button"
              onClick={() => onSetSelection([])}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="p-5">
        {videos.length === 0 ? (
          <div className="py-14 text-center text-sm font-medium text-slate-500">
            {searchQuery.trim()
              ? "No videos match your search."
              : 'No videos yet. Upload clips with "+ New" and they\'ll show up here automatically.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {videos.map((entry) => {
              const name = leafName(entry.name);
              const folder = parentFolder(entry.name);

              return (
                <div
                  key={entry.name}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(entry.name)}
                    onChange={() => onToggleSelect(entry.name)}
                    aria-label={`Select ${name}`}
                    className="absolute left-2 top-2 z-10 h-4 w-4 rounded border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => onView(entry)}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-slate-900 text-white"
                  >
                    <span className="text-4xl">▶️</span>
                    <span className="text-xs font-medium text-slate-300">Play</span>
                  </button>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium text-ink" title={entry.name}>
                      {name}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {folder ?? "My Vault"} · {formatSize(entry.size)}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => onExport(entry)}
                        className="rounded-full px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(entry)}
                        className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
