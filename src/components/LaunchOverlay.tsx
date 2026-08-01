interface LaunchOverlayProps {
  appName: string | null;
}

// Launching a portable app isn't instant — antivirus scanning a freshly
// extracted exe can add a few seconds of retry delay on the backend before
// the process actually spawns. Without this, a slow launch looks identical
// to a hung click, and users double-launch the same app while waiting.
export default function LaunchOverlay({ appName }: LaunchOverlayProps) {
  if (!appName) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="neo-panel flex flex-col items-center gap-4 bg-white px-10 py-8 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-neo-blue" />
        <div>
          <p className="text-base font-semibold text-ink">Launching {appName}…</p>
          <p className="mt-1 text-sm text-slate-500">This can take a few seconds the first time.</p>
        </div>
      </div>
    </div>
  );
}
