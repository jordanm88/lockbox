import { useEffect, useRef, useState } from "react";

interface NewMenuProps {
  disabled?: boolean;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onCreateFolder: () => void;
}

// The "+ New" split button is the single most recognizable piece of a
// Drive/Dropbox/OneDrive-style file browser — a primary pill button that
// opens a small dropdown of creation actions, instead of several separate
// toolbar buttons competing for attention.
export default function NewMenu({ disabled, onUploadFiles, onUploadFolder, onCreateFolder }: NewMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="text-lg leading-none">+</span> New
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
          <button
            type="button"
            onClick={() => pick(onUploadFiles)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <span className="text-base">📄</span> Upload files
          </button>
          <button
            type="button"
            onClick={() => pick(onUploadFolder)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <span className="text-base">📁</span> Upload folder
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => pick(onCreateFolder)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <span className="text-base">🗂️</span> New folder
          </button>
        </div>
      )}
    </div>
  );
}
