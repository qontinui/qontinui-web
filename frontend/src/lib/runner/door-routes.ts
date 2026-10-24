/**
 * The runner credential doors this app calls, and which of them the
 * same-origin door proxy (`/api/runner-doors/[...path]`) carries.
 *
 * Plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4. This
 * list equals the plan's Phase 0 census appendix: every `(method, route)` the
 * web frontend sends to a runner that the runner's own `is_credential_door`
 * classifies as a door. Patterns are the runner's axum route patterns
 * (`{name}` matches one path segment). `door-routes.census.test.ts` pins this
 * list to `door-routes.census.json`, a copy of the appendix.
 *
 * Shared by the browser (./door-client, which decides what to route through
 * the proxy) and the server (the proxy's allowlist). Pure: no imports.
 */

export interface RunnerDoorRoute {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: string;
}

export const RUNNER_DOOR_ROUTES: readonly RunnerDoorRoute[] = [
  // Doors in the runner's TRUSTED_DOOR_GRACE (admitted to :3001 until Phase 6).
  { method: "POST", pattern: "/settings/ai/api-key" },
  { method: "DELETE", pattern: "/settings/ai/api-key/{provider}" },
  { method: "POST", pattern: "/settings/self-healing/api-key" },
  { method: "DELETE", pattern: "/settings/self-healing/api-key/{provider}" },
  { method: "GET", pattern: "/settings/backup/summary" },
  { method: "POST", pattern: "/settings/backup/export" },
  { method: "POST", pattern: "/settings/backup/import" },
  { method: "GET", pattern: "/shell-commands/{id}" },
  { method: "POST", pattern: "/shell-commands/{id}/run" },
  { method: "POST", pattern: "/awas/discover" },
  { method: "POST", pattern: "/awas/check-support" },
  { method: "POST", pattern: "/awas/execute" },
  { method: "POST", pattern: "/contexts/{scope}/from-file" },
  { method: "POST", pattern: "/configs/parse" },
  { method: "POST", pattern: "/load-config" },
  { method: "POST", pattern: "/vision-extraction/extract" },
  { method: "POST", pattern: "/extraction/vision" },
  { method: "POST", pattern: "/pattern/find" },
  { method: "POST", pattern: "/pattern/find-all" },
  {
    method: "GET",
    pattern: "/extraction/{extraction_id}/screenshot/{screenshot_id}",
  },
  { method: "POST", pattern: "/checks/scan-workspace" },
  { method: "POST", pattern: "/rag/import" },
  { method: "POST", pattern: "/rag/{project_id}/load" },
  { method: "POST", pattern: "/capture-screenshot" },
  { method: "POST", pattern: "/extraction/start" },
  { method: "POST", pattern: "/uitars-extraction/start" },
  { method: "POST", pattern: "/ui-bridge/explore" },
  { method: "GET", pattern: "/hooks" },
  { method: "POST", pattern: "/hooks" },
  { method: "PUT", pattern: "/hooks/{id}" },
  { method: "DELETE", pattern: "/hooks/{id}" },
  { method: "PUT", pattern: "/hooks/{id}/enabled" },
  { method: "POST", pattern: "/hooks/{id}/test" },

  // Doors the web calls that are NOT graced, so the runner refuses them to
  // the :3001 page today (those features are already broken on the dev
  // frontend). Carried so the proxy restores them for the operator.
  { method: "POST", pattern: "/shell-commands" },
  { method: "PUT", pattern: "/shell-commands/{id}" },
  { method: "DELETE", pattern: "/shell-commands/{id}" },
  { method: "PUT", pattern: "/hooks/reorder" },
  { method: "DELETE", pattern: "/settings/playwright/password" },
  { method: "POST", pattern: "/api-request/test" },
  { method: "POST", pattern: "/execute-action" },
  { method: "POST", pattern: "/scheduler/tasks/{id}/run" },
  { method: "GET", pattern: "/state-explorer/{run_id}" },
  // The Inspector's API tab (operator-typed `/ui-bridge/sdk/<action>`).
  { method: "POST", pattern: "/ui-bridge/sdk/clipboard" },
  { method: "POST", pattern: "/ui-bridge/sdk/discover-and-cache" },
  { method: "POST", pattern: "/ui-bridge/sdk/execute-action-plan" },
];

/**
 * Doors the proxy must never carry, whatever is added above: pinned in a test.
 * Each is a capability no web page has a reason to cause.
 */
export const NEVER_PROXIED_PREFIXES: readonly string[] = [
  "/ui-bridge/invoke/",
  "/coord-mcp",
  "/files/",
  "/terminals",
  "/execute-python",
];

/**
 * The runner's own LITERAL routes that a `{param}` pattern above would
 * otherwise swallow (axum matches a literal segment before a parameter), and
 * which are not doors. Computed from the runner's route table against this
 * list; a new `{param}` door pattern needs this re-checked.
 */
export const LITERAL_NON_DOORS: readonly RunnerDoorRoute[] = [
  { method: "GET", pattern: "/state-explorer/history" },
  { method: "GET", pattern: "/state-explorer/strategies" },
  { method: "GET", pattern: "/state-explorer/cross-run-diff" },
];

function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s !== "");
}

function patternMatches(pattern: string, path: string): boolean {
  const ps = segmentsOf(pattern);
  const xs = segmentsOf(path);
  if (ps.length !== xs.length) return false;
  return ps.every((p, i) =>
    p.startsWith("{") && p.endsWith("}") ? xs[i] !== "" : p === xs[i]
  );
}

/**
 * The pattern of the door `method path` names, or null when it names none
 * this list carries. A query string is ignored.
 */
export function matchRunnerDoorRoute(
  method: string,
  path: string
): string | null {
  const m = method.toUpperCase();
  const bare = path.split("?")[0] ?? "";
  if (NEVER_PROXIED_PREFIXES.some((p) => bare.startsWith(p))) return null;
  if (
    LITERAL_NON_DOORS.some(
      (r) => r.method === m && patternMatches(r.pattern, bare)
    )
  ) {
    return null;
  }
  // Like axum, a literal segment beats a `{param}` one: PUT /hooks/reorder is
  // `/hooks/reorder`, not `/hooks/{id}`.
  let best: string | null = null;
  let bestParams = Infinity;
  for (const route of RUNNER_DOOR_ROUTES) {
    if (route.method === m && patternMatches(route.pattern, bare)) {
      const params = (route.pattern.match(/\{/g) ?? []).length;
      if (params < bestParams) {
        best = route.pattern;
        bestParams = params;
      }
    }
  }
  return best;
}
