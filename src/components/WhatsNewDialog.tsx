import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReleaseNotes } from "../lib/updateBridge";

interface WhatsNewDialogProps {
  release: ReleaseNotes | null;
  onDismiss: () => void;
}

// A GitHub release body is plain markdown (mostly "- " bullet lines and "##"
// headers); rendering it as preformatted text rather than pulling in a
// markdown parser keeps this simple while staying perfectly readable —
// release notes are short, structured lists, not richly formatted prose.
export default function WhatsNewDialog({ release, onDismiss }: WhatsNewDialogProps) {
  if (!release) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="neo-panel flex max-h-[80vh] w-full max-w-lg flex-col bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">What's new</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">{release.name || `Lockbox v${release.version}`}</h3>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-full px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-4">
          {release.body ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700">{release.body}</pre>
          ) : (
            <p className="text-sm text-slate-500">No release notes were provided for this version.</p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          {release.htmlUrl && (
            <button
              type="button"
              onClick={() =>
                release.htmlUrl && openUrl(release.htmlUrl).catch((err) => console.error("Failed to open release page", err))
              }
              className="neo-btn px-4 py-2"
            >
              View on GitHub
            </button>
          )}
          <button type="button" onClick={onDismiss} className="neo-btn bg-neo-blue px-4 py-2 text-white">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
