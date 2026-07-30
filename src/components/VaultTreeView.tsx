import type { VaultFileEntry } from "../lib/vaultBridge";

interface Props {
  entries: VaultFileEntry[];
  onView: (entry: VaultFileEntry) => void;
  onDelete: (entry: VaultFileEntry) => void;
}

export default function VaultTreeView({ entries, onView, onDelete }: Props) {
  // Simple flat list grouped by top-level folders — keep it lightweight.
  return (
    <div className="space-y-3">
      {entries.map((file) => (
        <div key={file.name} className="neo-panel flex items-center gap-4 p-4">
          <span className="text-2xl">{file.isDir ? "📁" : "📦"}</span>
          <div className="flex-1 min-w-0">
            <p className="truncate font-black text-ink">{file.name}</p>
            <p className="text-sm text-ink/60">{file.isDir ? "Folder" : `${file.size} bytes`}</p>
          </div>
          {!file.isDir && (
            <button onClick={() => onView(file)} className="neo-btn py-2 px-3">
              View
            </button>
          )}
          <button onClick={() => onDelete(file)} className="neo-btn py-2 px-3 bg-neo-red text-white">
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
