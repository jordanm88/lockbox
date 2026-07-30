import { useState } from "react";

interface Props {
  open: boolean;
  initial?: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
}

export default function CreateFolderDialog({ open, initial = "", onCreate, onCancel }: Props) {
  const [name, setName] = useState(initial);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="neo-panel w-full max-w-md p-6">
        <h3 className="text-xl font-black">Create Folder</h3>
        <p className="text-ink/70 mt-2">Enter a new folder name to create inside the vault.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 w-full rounded border px-3 py-2"
          placeholder="Folder name"
        />
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={onCancel} className="neo-btn py-2 px-4">
            Cancel
          </button>
          <button
            onClick={() => onCreate(name.trim())}
            disabled={!name.trim()}
            className="neo-btn bg-neo-blue text-white py-2 px-4"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
