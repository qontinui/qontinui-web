/**
 * Browser-required route classification + the NO_BROWSER_CONNECTED
 * envelope for the UI Bridge catch-all proxy (`route.ts`).
 *
 * Extracted (sibling-module pattern, like `_audit.ts` / `_auth.ts`) so the
 * contract is unit-testable deterministically: the E2E suite runs the dev
 * server, where `UIBridgeWrapper`'s `enableRemoteCommands` defaults to
 * true and tabs auto-attach to the relay — "no relay client attached" is
 * not a guaranteeable premise there, which made the old E2E assertion of
 * this contract order/timing-flaky. The vitest sibling
 * (`_browser-required.test.ts`) pins the route set and envelope shape
 * with zero environment.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface CompiledRoute {
  method: HttpMethod;
  regex: RegExp;
}

/**
 * Routes that require a live browser SDK client to produce a meaningful
 * response. When no relay client is attached (no WebSocket clients AND
 * no SSE listeners), the SDK's handler can only do one of three things,
 * all of which break the structured-error contract callers expect:
 *
 *   1. Read from a server-side registry populated by browser-side SDK
 *      calls — returns `success:true` with empty payload, indistinguishable
 *      from "browser connected, registry empty".
 *      Examples: `GET /control/components`, `POST /control/discover` (alias
 *      of `find`), `GET /control/snapshot`.
 *   2. Look up by id in an empty registry — returns
 *      `success:false code:UB-ELEM-NOT-FOUND`, indistinguishable from
 *      "browser connected, that specific id absent".
 *      Examples: `GET /control/element/:id`.
 *   3. `relayCommand` to the browser and wait for a response that never
 *      arrives — returns `success:false code:UB-ACTION-TIMEOUT` after the
 *      wait window expires.
 *      Examples: `POST /ai/wait-for-element`, `GET /ai/idle-status`.
 *
 * For these routes the empty registry / not-found / timeout response IS
 * the "no browser" signal. We short-circuit them to a structured
 * `NO_BROWSER_CONNECTED` 503 so callers reading `success`/`code` get the
 * same canonical envelope as the sibling routes gated by `isKnownRoute`
 * / `noBrowserResponse` (and as the SDK-404 fallthrough path).
 *
 * The set is intentionally narrow: only routes whose semantics genuinely
 * need a live browser-side SDK client belong here. Routes whose payload
 * is populated server-side regardless of browser connection (spec
 * discovery, app-info, transport diagnostics, etc.) must NOT be added.
 */
export const BROWSER_REQUIRED_ROUTES: readonly CompiledRoute[] = [
  // Registry-backed (class 1): server-side reads of browser-populated state.
  { method: "GET", regex: /^\/control\/components$/ },
  { method: "GET", regex: /^\/control\/snapshot$/ },
  { method: "POST", regex: /^\/control\/discover$/ },
  // ID-lookup-backed (class 2): empty registry == NOT_FOUND for any id.
  { method: "GET", regex: /^\/control\/element\/([^/]+)$/ },
  // Relay-backed (class 3): handler awaits a browser response that
  // never arrives, currently returning UB-ACTION-TIMEOUT after the
  // wait window.
  { method: "POST", regex: /^\/ai\/wait-for-element$/ },
  { method: "GET", regex: /^\/ai\/idle-status$/ },
];

/**
 * True when `path` + `method` is a route that requires a live browser
 * SDK client to produce a meaningful response, so the proxy should
 * surface `NO_BROWSER_CONNECTED` when no relay client is currently
 * attached. See `BROWSER_REQUIRED_ROUTES` for rationale.
 */
export function isBrowserRequiredRoute(
  path: string,
  method: HttpMethod,
): boolean {
  for (const route of BROWSER_REQUIRED_ROUTES) {
    if (route.method === method && route.regex.test(path)) return true;
  }
  return false;
}

export function noBrowserResponse(path: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "NO_BROWSER_CONNECTED",
      message: `${path} requires a browser SDK client`,
    }),
    {
      status: 503,
      headers: { "Content-Type": "application/json" },
    },
  );
}
