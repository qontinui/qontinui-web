/**
 * Typed abort reasons for the app's own client timeouts.
 *
 * A timeout aborts through the same `AbortController` a caller or a navigation
 * uses, so the rejection alone cannot say which happened. Aborting a timeout
 * with a `TimeoutError` reason (the name `AbortSignal.timeout` uses) lets an
 * observer — the telemetry beacon — report the timeout as an incident while
 * dropping a caller's or navigation's `AbortError`. Plan
 * 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429, Phase 5.
 */

/** The reason every client timeout aborts with. */
export function timeoutAbortReason(): DOMException {
  return new DOMException("Request timed out", "TimeoutError");
}

/**
 * True for a rejection caused by an abort — the client timeout's
 * `TimeoutError` or any `AbortError`. For catchers that treat both alike.
 */
export function isAbortOrTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
