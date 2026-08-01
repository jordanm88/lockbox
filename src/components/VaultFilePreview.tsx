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
  const isVideo = mimeType.startsWith("video/");
  const isPdf = mimeType === "application/pdf";
  const isText = mimeType.startsWith("text/") || mimeType === "application/json";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 p-3 sm:p-6" onClick={onClose}>
      <div
        className="neo-panel flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden bg-white p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              <span className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-slate-200">Preview</span>
              <span className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-slate-200">Drive-style viewer</span>
            </div>
            <h3 className="mt-2 truncate text-lg font-semibold text-ink sm:text-xl">{name}</h3>
            <p className="text-sm text-slate-600">{isImage ? "Image" : isVideo ? "Video" : isPdf ? "PDF" : isText ? "Text" : "File"}</p>
          </div>
          <button type="button" onClick={onClose} className="neo-btn shrink-0 rounded-full bg-white px-4 py-2 text-slate-700">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 bg-slate-100 p-3 sm:p-6">
          <div className="neo-panel h-full overflow-hidden bg-white p-2 sm:p-4">
            <div className="h-full min-h-0">
              {isImage && <img src={objectUrl} alt={name} className="mx-auto max-h-full w-auto max-w-full object-contain" />}
              {isVideo && (
                <video src={objectUrl} controls autoPlay className="mx-auto h-full max-h-full w-auto max-w-full">
                  Your browser can't play this video format.
                </video>
              )}
              {isPdf && <iframe title={name} src={objectUrl} className="h-full min-h-[52vh] w-full sm:min-h-[68vh]" />}
              {isText && <TextPreview objectUrl={objectUrl} />}
              {!isImage && !isVideo && !isPdf && !isText && (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm font-medium text-slate-600">
                  Preview not supported for this file type yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
