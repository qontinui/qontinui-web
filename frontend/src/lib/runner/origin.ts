/**
 * Can this page's origin reach a loopback runner at all?
 *
 * Loopback is reachable only from a localhost origin: production pages
 * (qontinui.io) are blocked by Chrome's Local Network Access
 * (public→loopback). This is a runtime gate on the page's own origin, not on
 * NODE_ENV, because one bundle ships to dev previews and production aliases.
 * Under SSR there is no browser, so it is false.
 *
 * It says nothing about WHICH machine a runner is on — that is ./locality.
 * Kept here (no imports) so the runner transport modules and
 * `@/lib/ui-bridge/discovered-specs` (which re-exports it) share one gate
 * without an import cycle.
 */
export function isRunnerReachable(): boolean {
  if (typeof window === "undefined") return false;
  const origin = window.location.origin;
  return (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://[::1]")
  );
}
