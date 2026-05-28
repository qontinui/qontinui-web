/**
 * UI Bridge API Routes
 *
 * Catch-all route handler for all UI Bridge API endpoints.
 * Uses the SDK's CommandRelay for browser-server communication.
 *
 * Relay routes (handled before normal routing):
 * - GET  /commands/stream — SSE command delivery to browser
 * - POST /commands        — browser sends command responses
 * - POST /heartbeat       — browser heartbeat
 * - GET  /health          — transport diagnostics
 * - GET  /tabs            — connected tab info
 *
 * All other routes are handled by the SDK's route matcher.
 *
 * Local pre-processing (this module):
 * - Paths that match neither `UI_BRIDGE_ROUTES` (the SDK's canonical
 *   route contract) nor the relay-transport set above would otherwise
 *   produce a bare HTTP 404 from the SDK. We short-circuit them to HTTP
 *   503 with `{success:false, code:"NO_BROWSER_CONNECTED", ...}` so
 *   callers reading `success`/`code` get a structured signal instead of
 *   404. Notable paths in this bucket (iter 2 + iter 4): `/ai/find`
 *   aliases, `/control/page-health`, `/control/tabs`, `/sdk/*`,
 *   `/control/network/*` stub routes.
 *
 *   The proxy auto-tracks the SDK contract: when the SDK adds a route to
 *   `UI_BRIDGE_ROUTES`, the proxy stops 503-ing it and forwards instead —
 *   no allow-list maintenance required.
 *
 * - Routes that DO exist in `UI_BRIDGE_ROUTES` but whose SDK handler
 *   cannot meaningfully respond without a live browser SDK client (the
 *   handler would return `success:true` with empty data, an
 *   `UB-ELEM-NOT-FOUND` for any id, or `UB-ACTION-TIMEOUT` after the
 *   relay-wait window expires) are short-circuited to the same
 *   `NO_BROWSER_CONNECTED` 503 envelope when no relay client is
 *   currently attached. The enumerated set lives in
 *   `BROWSER_REQUIRED_ROUTES` and currently covers
 *   `/control/{components,snapshot,discover}`,
 *   `/control/element/:id`, `/ai/wait-for-element`, `/ai/idle-status`.
 */

import {
  createNextRouteHandlers,
  SSEManager,
  UI_BRIDGE_ROUTES,
} from "@qontinui/ui-bridge/server";
import { handlers, relay } from "@/lib/ui-bridge/relay";
import { NextRequest } from "next/server";
import { passThroughBody } from "./body-passthrough";
import {
  isWebRouteRejected,
  forbiddenWebRouteResponse,
} from "./web-forbidden-routes";

const sseManager = new SSEManager();

const routeHandlers = createNextRouteHandlers(handlers, {
  relay,
  sseManager,
  appInfo: {
    appId: "qontinui-web",
    appName: "Qontinui Web",
    appType: "web",
    framework: "nextjs",
  },
});

// Wrap handlers to adapt from Next.js 15 async params to the expected sync params
type NextContext = { params: Promise<{ path: string[] }> };

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

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

interface CompiledRoute {
  method: HttpMethod;
  regex: RegExp;
}

const COMPILED_SDK_ROUTES: readonly CompiledRoute[] = UI_BRIDGE_ROUTES.map(
  (route) => ({
    method: route.method as HttpMethod,
    regex: compileRouteRegex(route.path),
  }),
);

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
const BROWSER_REQUIRED_ROUTES: readonly CompiledRoute[] = [
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
 * `NO_BROWSER_CONNECTED` 503.
 */
function isKnownRoute(path: string, method: HttpMethod): boolean {
  for (const route of COMPILED_SDK_ROUTES) {
    if (route.method === method && route.regex.test(path)) return true;
  }
  for (const route of RELAY_TRANSPORT_ROUTES) {
    if (route.method === method && route.regex.test(path)) return true;
  }
  return false;
}

/**
 * True when `path` + `method` is a route that requires a live browser
 * SDK client to produce a meaningful response, so the proxy should
 * surface `NO_BROWSER_CONNECTED` when no relay client is currently
 * attached. See `BROWSER_REQUIRED_ROUTES` for rationale.
 */
function isBrowserRequiredRoute(path: string, method: HttpMethod): boolean {
  for (const route of BROWSER_REQUIRED_ROUTES) {
    if (route.method === method && route.regex.test(path)) return true;
  }
  return false;
}

/**
 * True when no browser tab is currently connected to the relay — neither
 * via WebSocket nor via SSE. The relay's own `sendCommand` checks the
 * same predicate (`!sentViaWebSocket && this.tabListeners.size === 0`)
 * before rejecting non-fire-and-forget commands; we apply the same gate
 * to the registry-backed set so the silent-success path can't fire.
 */
function noRelayClientsConnected(): boolean {
  return !relay.hasCommandListeners() && relay.getWebSocketClientCount() === 0;
}

function noBrowserResponse(path: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "NO_BROWSER_CONNECTED",
      message: `${path} requires a browser SDK client`,
    }),
    {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function resolvePath(params: { path: string[] }): string {
  return "/" + params.path.join("/");
}

async function wrapHandler(
  handler: (
    req: NextRequest,
    ctx: { params: Record<string, string> }
  ) => Promise<Response>,
  request: NextRequest,
  context: NextContext,
  method: "GET" | "POST" | "PUT" | "DELETE"
): Promise<Response> {
  const params = await context.params;
  const path = resolvePath(params);

  // Hard reject paths forbidden on a DEPLOYED web surface (e.g.
  // `/control/page/evaluate` — see `web-forbidden-routes.ts`). Scoped to
  // production builds, so local `next dev` keeps full UI Bridge power for
  // manual testing. Runs BEFORE any SDK-contract / browser-connected checks
  // so a future SDK release that adds a forbidden path to UI_BRIDGE_ROUTES
  // cannot re-enable it on a deployment.
  if (isWebRouteRejected(path)) {
    return forbiddenWebRouteResponse(path);
  }

  // Pre-process: short-circuit routes the SDK would 404 on. We surface a
  // structured 503 NO_BROWSER_CONNECTED instead of a bare 404 so callers
  // reading `success`/`code` (page-health probes, runner SDK shims,
  // multi-tab debug UI) get a meaningful signal. The check is derived from
  // UI_BRIDGE_ROUTES + the relay-transport set — no hardcoded allow-list,
  // so the proxy auto-tracks new SDK routes as the SDK ships them.
  if (!isKnownRoute(path, method)) {
    return noBrowserResponse(path);
  }

  // Pre-process: short-circuit browser-required routes when no browser
  // is connected. The SDK handlers behind these paths can't distinguish
  // "no browser attached" from their natural empty/not-found/timeout
  // response; mirror the unknown-route gate so callers reading
  // `success`/`code` get a single canonical `NO_BROWSER_CONNECTED` 503
  // envelope across the board. See `BROWSER_REQUIRED_ROUTES` for the
  // three handler classes this covers.
  if (isBrowserRequiredRoute(path, method) && noRelayClientsConnected()) {
    return noBrowserResponse(path);
  }

  // Body-preservation pass-through: re-wrap any POST/PUT/PATCH so the SDK's
  // `request.json()` sees the inbound body byte-for-byte with an explicit
  // `Content-Type: application/json` header. Closes the field-strip class
  // of bug observed on Vercel deploys where e.g. a `{text:"X"}` body
  // arrived at the relay with `text` missing.
  const forwardRequest = await passThroughBody(request, method);

  return handler(forwardRequest, { params: { path: params.path.join("/") } });
}

export async function GET(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.GET, request, context, "GET");
}

export async function POST(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.POST, request, context, "POST");
}

export async function PUT(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.PUT, request, context, "PUT");
}

export async function DELETE(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.DELETE, request, context, "DELETE");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
