import { useEffect, useMemo, useRef, useState } from "react";
import { readAndDecryptFile, type VaultFileEntry } from "../lib/vaultBridge";
import { isImageFile } from "../lib/fileKind";
import { mimeTypeFor } from "../lib/mime";

interface PicturesGridProps {
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
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

// A picture spans the whole vault regardless of which folder it lives in, so
// this is a flat gallery rather than a folder-by-folder browser like the
// main tree view — that's the entire point of a dedicated Pictures section.
export default function PicturesGrid({
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
}: PicturesGridProps) {
  const pictures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return entries
      .filter((entry) => !entry.isDir && isImageFile(entry.name))
      .filter((entry) => !query || leafName(entry.name).toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, searchQuery]);

  // Thumbnails are decrypted lazily, one tile at a time, only once a tile
  // actually scrolls into view — the same on-demand decrypt the full-size
  // preview modal already does, just triggered by an IntersectionObserver
  // instead of a click, so opening Pictures never decrypts the whole vault's
  // worth of images up front.
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());
  const observedRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    return () => {
      setThumbnails((current) => {
        current.forEach((url) => URL.revokeObjectURL(url));
        return new Map();
      });
    };
  }, []);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (observed) => {
        for (const item of observed) {
          if (!item.isIntersecting) continue;
          const path = item.target.getAttribute("data-path");
          observerRef.current?.unobserve(item.target);
          if (path) void loadThumbnail(path);
        }
      },
      { rootMargin: "200px" },
    );
    return () => observerRef.current?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadThumbnail(path: string) {
    if (thumbnails.has(path) || loadingRef.current.has(path) || failed.has(path)) return;
    loadingRef.current.add(path);
    try {
      const bytes = await readAndDecryptFile(path);
      const blob = new Blob([bytes as BlobPart], { type: mimeTypeFor(path) });
      const url = URL.createObjectURL(blob);
      setThumbnails((current) => new Map(current).set(path, url));
    } catch {
      setFailed((current) => new Set(current).add(path));
    } finally {
      loadingRef.current.delete(path);
    }
  }

  function registerTile(node: HTMLDivElement | null, path: string) {
    if (!node || !observerRef.current || observedRef.current.has(path)) return;
    observedRef.current.add(path);
    observerRef.current.observe(node);
  }

  const visiblePaths = useMemo(() => pictures.map((p) => p.name), [pictures]);
  const allVisibleSelected = visiblePaths.length > 0 && visiblePaths.every((path) => selectedPaths.has(path));

  function toggleSelectAllVisible() {
    onSetSelection(allVisibleSelected ? [] : visiblePaths);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-xl font-semibold text-ink">
            {searchQuery.trim() ? `Search results for "${searchQuery.trim()}"` : "Pictures"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {pictures.length} picture{pictures.length === 1 ? "" : "s"} found across your vault.
          </p>
        </div>
        {pictures.length > 0 && (
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
        {pictures.length === 0 ? (
          <div className="py-14 text-center text-sm font-medium text-slate-500">
            {searchQuery.trim()
              ? "No pictures match your search."
              : 'No pictures yet. Upload images with "+ New" and they\'ll show up here automatically.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {pictures.map((entry) => {
              const name = leafName(entry.name);
              const folder = parentFolder(entry.name);
              const url = thumbnails.get(entry.name);
              const thumbFailed = failed.has(entry.name);

              return (
                <div
                  key={entry.name}
                  ref={(node) => registerTile(node, entry.name)}
                  data-path={entry.name}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(entry.name)}
                    onChange={() => onToggleSelect(entry.name)}
                    aria-label={`Select ${name}`}
                    className="absolute left-2 top-2 z-10 h-4 w-4 rounded border-slate-300"
                  />
                  <button type="button" onClick={() => onView(entry)} className="block aspect-square w-full bg-slate-100">
                    {url ? (
                      <img src={url} alt={name} className="h-full w-full object-cover" />
                    ) : thumbFailed ? (
                      <div className="flex h-full w-full items-center justify-center text-2xl">🖼️</div>
                    ) : (
                      <div className="flex h-full w-full animate-pulse items-center justify-center text-2xl text-slate-300">
                        🖼️
                      </div>
                    )}
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
