/**
 * Tracks throughput across a series of progress ticks using an exponentially
 * weighted moving average (EWMA) of instantaneous speed, rather than a
 * single elapsed-time/total-bytes average. A plain average reacts slowly to
 * real speed changes (e.g. a fast small file followed by a slow large one
 * drags the estimate the wrong way for a while); EWMA weights recent samples
 * more heavily so the estimate adapts within a few ticks while still
 * smoothing out per-chunk noise, which is the standard technique for this
 * (the same idea TCP uses for RTT estimation).
 */
export class TransferSpeedTracker {
  private lastTimeMs: number;
  private lastBytes: number;
  private smoothedBytesPerSec: number | null = null;

  // Higher = more reactive to recent samples, lower = smoother/slower to
  // adjust. 0.3 settles within roughly 5-10 ticks without being so reactive
  // that a single slow chunk swings the ETA wildly.
  private static readonly ALPHA = 0.3;
  // Ignore ticks closer together than this — the timing noise at very short
  // intervals produces instantaneous-speed samples that are mostly jitter,
  // not signal.
  private static readonly MIN_INTERVAL_MS = 50;

  constructor(startBytes = 0, now: number = performance.now()) {
    this.lastTimeMs = now;
    this.lastBytes = startBytes;
  }

  /** Feed a new "bytes completed so far" reading; call on every progress tick. */
  sample(completedBytes: number, now: number = performance.now()): void {
    const dtMs = now - this.lastTimeMs;
    const dBytes = completedBytes - this.lastBytes;
    if (dtMs < TransferSpeedTracker.MIN_INTERVAL_MS || dBytes <= 0) return;

    const instantaneous = dBytes / (dtMs / 1000);
    this.smoothedBytesPerSec =
      this.smoothedBytesPerSec === null
        ? instantaneous
        : TransferSpeedTracker.ALPHA * instantaneous + (1 - TransferSpeedTracker.ALPHA) * this.smoothedBytesPerSec;

    this.lastTimeMs = now;
    this.lastBytes = completedBytes;
  }

  /** Current smoothed throughput, or null until at least one valid sample has landed. */
  bytesPerSecond(): number | null {
    return this.smoothedBytesPerSec;
  }

  /** Seconds remaining for `remainingBytes` at the current smoothed speed, or null if not yet known. */
  etaSeconds(remainingBytes: number): number | null {
    if (this.smoothedBytesPerSec === null || this.smoothedBytesPerSec <= 0 || remainingBytes <= 0) return null;
    return remainingBytes / this.smoothedBytesPerSec;
  }
}

/** "~45s", "~2m 10s", "~1h 05m" — deliberately coarse, an ETA to the second is false precision. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Calculating…";
  if (seconds < 3) return "Almost done…";

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return `~${hours}h ${String(minutes).padStart(2, "0")}m left`;
  if (minutes > 0) return `~${minutes}m ${String(secs).padStart(2, "0")}s left`;
  return `~${secs}s left`;
}
