/**
 * UI Bridge paths that are permanently forbidden on the web surface,
 * regardless of SDK contract state.
 *
 * The canonical entry is `/control/page/evaluate`: the SDK ships this route
 * as a `js eval` escape hatch for the runner's trusted-context Tauri webview
 * (a single-user app the operator launched themselves). On a multi-tenant
 * web origin like qontinui.io, exposing it would give any caller arbitrary
 * code execution inside a logged-in user's browser — full account takeover
 * in one HTTP call.
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

export function isForbiddenWebRoute(path: string): boolean {
  return WEB_FORBIDDEN_PATHS.has(path);
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
