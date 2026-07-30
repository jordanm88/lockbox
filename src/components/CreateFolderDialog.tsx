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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="neo-panel w-full max-w-md bg-white p-6">
        <h3 className="text-xl font-semibold text-ink">Create Folder</h3>
        <p className="mt-2 text-slate-600">Enter a new folder name to create inside the vault.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="neo-input mt-4 w-full px-3 py-2"
          placeholder="Folder name"
        />
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={onCancel} className="neo-btn px-4 py-2">
            Cancel
          </button>
          <button
            onClick={() => onCreate(name.trim())}
            disabled={!name.trim()}
            className="neo-btn bg-neo-blue px-4 py-2 text-white"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
