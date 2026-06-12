/**
 * Route classification + structured error envelopes for the UI Bridge
 * catch-all proxy (`route.ts`):
 *
 *   - browser-required routes → `NO_BROWSER_CONNECTED` 503 when no relay
 *     client is attached (`isBrowserRequiredRoute` / `noBrowserResponse`),
 *   - unknown routes (no entry in the SDK's `UI_BRIDGE_ROUTES` manifest or
 *     the relay-transport set) → `UNKNOWN_ROUTE` 404
 *     (`isKnownRoute` / `unknownRouteResponse`).
 *
 * Extracted (sibling-module pattern, like `_audit.ts` / `_auth.ts`) so the
 * contract is unit-testable deterministically: the E2E suite runs the dev
 * server, where `UIBridgeWrapper`'s `enableRemoteCommands` defaults to
 * true and tabs auto-attach to the relay — "no relay client attached" is
 * not a guaranteeable premise there, which made the old E2E assertion of
 * this contract order/timing-flaky. The vitest sibling
 * (`_browser-required.test.ts`) pins the route sets and envelope shapes
 * with zero environment.
 */

import { UI_BRIDGE_ROUTES } from "@qontinui/ui-bridge/server";

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
 * `NO_BROWSER_CONNECTED` 503 so callers reading `success`/`code` get one
 * canonical no-client envelope. (Routes that don't exist at all get the
 * distinct `UNKNOWN_ROUTE` 404 via `isKnownRoute` / `unknownRouteResponse`
 * below — the two conditions must never share an envelope.)
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

/**
 * Compile a UI_BRIDGE_ROUTES entry (e.g. `/control/element/:id/state`) to an
 * anchored regex matching concrete request paths. Mirrors the SDK's
 * `findMatchingRoute` so we stay byte-compatible with what the SDK accepts —
 * if the SDK would match, so do we; if it wouldn't, neither do we.
 */
function compileRouteRegex(routePath: string): RegExp {
  const source = routePath
    .replace(/:[^/]+/g, "([^/]+)")
    .replace(/\//g, "\\/");
  return new RegExp(`^${source}$`);
}

const COMPILED_SDK_ROUTES: readonly CompiledRoute[] = UI_BRIDGE_ROUTES.map(
  (route) => ({
    method: route.method as HttpMethod,
    regex: compileRouteRegex(route.path),
  }),
);

/**
 * Relay-transport paths the SDK's `handleRelayRoute` claims before the
 * UI_BRIDGE_ROUTES matcher runs. None of these appear in UI_BRIDGE_ROUTES,
 * so we list them explicitly. Order doesn't matter — these are checked
 * in `isKnownRoute` alongside the SDK routes.
 *
 * Sources (SDK 0.8.0, `dist/server/nextjs.mjs::handleRelayRoute`):
 *   - GET  /commands/stream             (SSE command delivery)
 *   - POST /commands                    (browser command responses)
 *   - GET  /health, GET /status         (transport diagnostics)
 *   - GET  /tabs, GET /tabs/wait        (tab info / blocking wait)
 *   - POST /tabs/:id/activate           (CDP tab activate)
 *   - POST /tabs/:id/close              (CDP tab close)
 *   - GET  /control/events/stream       (SSE)
 *   - GET  /control/changes/stream      (SSE)
 *
 * `POST /heartbeat` is intentionally also in UI_BRIDGE_ROUTES, so it's
 * already covered by COMPILED_SDK_ROUTES.
 */
const RELAY_TRANSPORT_ROUTES: readonly CompiledRoute[] = [
  { method: "GET", regex: /^\/commands\/stream$/ },
  { method: "POST", regex: /^\/commands$/ },
  { method: "GET", regex: /^\/health$/ },
  { method: "GET", regex: /^\/status$/ },
  { method: "GET", regex: /^\/tabs$/ },
  { method: "GET", regex: /^\/tabs\/wait$/ },
  { method: "POST", regex: /^\/tabs\/([^/]+)\/activate$/ },
  { method: "POST", regex: /^\/tabs\/([^/]+)\/close$/ },
  { method: "GET", regex: /^\/control\/events\/stream$/ },
  { method: "GET", regex: /^\/control\/changes\/stream$/ },
];

/**
 * True when `path` + `method` would be claimed either by the SDK's
 * `UI_BRIDGE_ROUTES` matcher OR by the relay-transport handler. False
 * means the SDK would 404; the proxy translates that to a structured
 * `UNKNOWN_ROUTE` 404 (see `unknownRouteResponse`).
 */
export function isKnownRoute(path: string, method: HttpMethod): boolean {
  for (const route of COMPILED_SDK_ROUTES) {
    if (route.method === method && route.regex.test(path)) return true;
  }
  for (const route of RELAY_TRANSPORT_ROUTES) {
    if (route.method === method && route.regex.test(path)) return true;
  }
  return false;
}

/**
 * Hints for paths callers plausibly guess but that live elsewhere in the
 * route contract. Keyed by the unknown path; the value names the real
 * route family. Keep entries to observed-in-the-wild confusions only.
 */
const UNKNOWN_ROUTE_HINTS: Readonly<Record<string, string>> = {
  // Observed 2026-06-12: a live drive session chased a phantom
  // "no browser" predicate because /ai/forms 503'd as NO_BROWSER_CONNECTED.
  "/ai/forms": "forms live at GET /control/forms",
};

/**
 * Structured 404 for paths that match neither `UI_BRIDGE_ROUTES` nor the
 * relay-transport set. Honest about uncertainty: "no such route" must be
 * distinguishable from "no browser attached" (`NO_BROWSER_CONNECTED` 503)
 * — conflating the two sends callers chasing phantom connectivity issues.
 */
export function unknownRouteResponse(path: string): Response {
  const hint = UNKNOWN_ROUTE_HINTS[path];
  return new Response(
    JSON.stringify({
      success: false,
      code: "UNKNOWN_ROUTE",
      message:
        `${path} is not a UI Bridge route (no entry in the SDK's ` +
        `UI_BRIDGE_ROUTES manifest or the relay transport set)` +
        (hint ? `; ${hint}` : ""),
    }),
    {
      status: 404,
      headers: { "Content-Type": "application/json" },
    },
  );
}
