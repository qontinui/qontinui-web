/**
 * UI Bridge paths forbidden on a DEPLOYED (multi-tenant) web surface.
 *
 * The canonical entry is `/control/page/evaluate`: the SDK ships this route
 * as a `js eval` escape hatch for the runner's trusted-context Tauri webview
 * (a single-user app the operator launched themselves). On a multi-tenant
 * web origin like qontinui.io, exposing it would give any caller arbitrary
 * code execution inside a logged-in user's browser — full account takeover
 * in one HTTP call.
 *
 * Scope is by environment, not absolute: the threat is the *deployed*,
 * multi-tenant origin. A local `next dev` server is a single-operator,
 * trusted context — the same trust model under which the SDK already exposes
 * `page/evaluate` to the runner's Tauri webview — and is where UI-Bridge
 * manual testing runs with full power. So the hard-reject fires only when
 * `isDeployedWebSurface()` is true. Every Vercel build (preview AND
 * production) is `NODE_ENV=production`, so all multi-tenant deployments are
 * covered; only local dev is exempt. `NODE_ENV` is set by the framework and
 * is not request-controllable, so it can't be spoofed to re-open the hole.
 *
 * The relay route handler short-circuits these paths with a structured
 * `403 ROUTE_FORBIDDEN_ON_WEB` BEFORE consulting the SDK route table, so a
 * hypothetical future SDK release that adds the path to web's
 * `UI_BRIDGE_ROUTES` cannot accidentally re-enable it. Belt-and-suspenders
 * on top of the SDK contract.
 *
 * Cross-link: `plans/2026-05-28-production-safe-ui-bridge-design.md` §4.7.
 */

const WEB_FORBIDDEN_PATHS: ReadonlySet<string> = new Set([
  "/control/page/evaluate",
]);

/**
 * True on a deployed production build (Vercel preview + prod are both
 * `NODE_ENV=production`); false under local `next dev`. Gates the
 * forbidden-route hard-reject so local dev keeps full UI Bridge power.
 */
export function isDeployedWebSurface(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Whether `path` is in the forbidden set (pure membership; env-independent). */
export function isForbiddenWebRoute(path: string): boolean {
  return WEB_FORBIDDEN_PATHS.has(path);
}

/**
 * Enforcement predicate: reject `path` only when it's forbidden AND we're on
 * a deployed multi-tenant surface. Local `next dev` is never rejected.
 */
export function isWebRouteRejected(path: string): boolean {
  return isDeployedWebSurface() && isForbiddenWebRoute(path);
}

export function forbiddenWebRouteResponse(path: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "ROUTE_FORBIDDEN_ON_WEB",
      message: `${path} is not available on the web UI Bridge surface`,
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}
