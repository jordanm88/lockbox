/**
 * Tauri commands return `Result<T, String>` on the Rust side. When one
 * fails, the rejected `invoke()` promise resolves to that raw string value
 * directly — Tauri does not wrap it in a JS `Error`. `err instanceof Error`
 * is therefore always false for a backend failure, and any
 * `err instanceof Error ? err.message : fallback` check silently discards
 * the actual Rust error message in favor of the generic fallback every
 * single time. This normalizes every shape we might actually see (plain
 * string from Tauri, a real Error from browser/JS APIs, or anything else)
 * into one message.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.length > 0) return err;
  if (err instanceof Error && err.message) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
