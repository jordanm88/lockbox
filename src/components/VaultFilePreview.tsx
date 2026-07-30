import { useEffect, useState } from "react";

interface VaultFilePreviewProps {
  name: string;
  objectUrl: string;
  mimeType: string;
  onClose: () => void;
}

function TextPreview({ objectUrl }: { objectUrl: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(objectUrl)
      .then((res) => res.text())
      .then((value) => {
        if (!cancelled) setText(value);
      });
    return () => {
      cancelled = true;
    };
  }, [objectUrl]);

  return (
    <pre className="neo-border h-full min-h-[45vh] overflow-auto whitespace-pre-wrap bg-white p-4 font-mono text-sm sm:min-h-[60vh]">
      {text ?? "Loading…"}
    </pre>
  );
}

export default function VaultFilePreview({ name, objectUrl, mimeType, onClose }: VaultFilePreviewProps) {
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const isText = mimeType.startsWith("text/") || mimeType === "application/json";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/80 p-3 sm:p-6" onClick={onClose}>
      <div
        className="neo-panel flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden bg-paper p-4 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="truncate text-lg font-semibold text-ink sm:text-xl">{name}</h3>
            <p className="text-sm text-slate-600">Preview</p>
          </div>
          <button type="button" onClick={onClose} className="neo-btn shrink-0 rounded-sm bg-neo-red px-4 py-2 text-white">
            ✕ Close
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {isImage && <img src={objectUrl} alt={name} className="neo-border mx-auto max-h-full w-auto max-w-full object-contain" />}
          {isPdf && <iframe title={name} src={objectUrl} className="neo-border h-full min-h-[52vh] w-full sm:min-h-[68vh]" />}
          {isText && <TextPreview objectUrl={objectUrl} />}
          {!isImage && !isPdf && !isText && (
            <p className="font-medium text-slate-600">Preview not supported for this file type yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
