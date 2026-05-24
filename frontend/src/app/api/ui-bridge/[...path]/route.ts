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
 * Local pre/post-processing (this module):
 * - Paths that match neither `UI_BRIDGE_ROUTES` (the SDK's canonical
 *   route contract) nor the relay-transport set above would otherwise
 *   produce a bare HTTP 404 from the SDK. We short-circuit them to HTTP
 *   503 with `{success:false, code:"NO_BROWSER_CONNECTED", ...}` so
 *   callers reading `success`/`code` get a structured signal instead of
 *   404. Notable paths in this bucket (iter 2 + iter 4): `/ai/idle-status`,
 *   `/ai/find` aliases, `/control/page-health`, `/control/tabs`,
 *   `/sdk/*`, `/control/network/*` stub routes.
 *
 *   The proxy auto-tracks the SDK contract: when the SDK adds a route to
 *   `UI_BRIDGE_ROUTES`, the proxy stops 503-ing it and forwards instead —
 *   no allow-list maintenance required.
 *
 * - For `/control/snapshot`, when the SDK returns `success:true` but the
 *   snapshot is stale AND empty (no browser actually attached, just a
 *   cached empty payload), the response is rewritten to
 *   `{success:false, code:"NO_BROWSER", ...}` so callers don't confuse
 *   "no browser" with "page has no elements".
 */

import {
  createNextRouteHandlers,
  SSEManager,
  UI_BRIDGE_ROUTES,
} from "@qontinui/ui-bridge/server";
import { handlers, relay } from "@/lib/ui-bridge/relay";
import { NextRequest } from "next/server";
import { passThroughBody } from "./body-passthrough";

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
 * Routes the SDK answers from local in-process state (component registry,
 * etc.) rather than the browser-side SDK channel. The handler returns
 * `success:true` with an empty payload whenever the registry is empty,
 * which is indistinguishable from "no browser is connected" — callers
 * reading `success` boolean cannot tell the two cases apart.
 *
 * For these routes, when no relay client is actually attached (no
 * WebSocket clients AND no SSE listeners), the empty registry IS the
 * "no browser" signal. We short-circuit them to `NO_BROWSER_CONNECTED`
 * 503 so callers get the same structured signal as the sibling routes
 * gated by `isKnownRoute` / `noBrowserResponse`.
 *
 * The set is intentionally narrow: only routes whose payload is sourced
 * from a browser-populated registry belong here. Routes whose payload
 * is populated server-side regardless of browser connection (spec
 * discovery, app-info, etc.) must NOT be added.
 */
const BROWSER_REGISTRY_ROUTES: readonly CompiledRoute[] = [
  { method: "GET", regex: /^\/control\/components$/ },
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
 * True when `path` + `method` is a registry-backed route that should
 * surface `NO_BROWSER_CONNECTED` when no relay client is currently
 * attached. See `BROWSER_REGISTRY_ROUTES` for rationale.
 */
function isBrowserRegistryRoute(path: string, method: HttpMethod): boolean {
  for (const route of BROWSER_REGISTRY_ROUTES) {
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

/**
 * Rewrites a successful snapshot response into a `NO_BROWSER` failure when
 * the snapshot is stale AND empty. Other successful responses pass through
 * unchanged. Returns the original `response` if no rewrite applies.
 *
 * Reads the body as text first and re-emits, so we don't lose unknown
 * fields (timestamp, _meta, etc.).
 */
async function rewriteStaleEmptySnapshot(response: Response): Promise<Response> {
  if (response.status !== 200) return response;
  const ct = response.headers.get("Content-Type") ?? "";
  if (!ct.includes("application/json")) return response;

  // Cloning is cheap and lets us fall back to the original if parsing fails.
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (
    body === null ||
    typeof body !== "object" ||
    (body as { success?: unknown }).success !== true
  ) {
    return response;
  }

  const obj = body as {
    success: true;
    data?: { elements?: unknown[] };
    _meta?: { stale?: boolean };
  };

  const isStale = obj._meta?.stale === true;
  const elements = Array.isArray(obj.data?.elements) ? obj.data!.elements : null;
  const isEmpty = elements !== null && elements.length === 0;

  if (!isStale || !isEmpty) return response;

  const rewritten = {
    success: false as const,
    code: "NO_BROWSER",
    message: "snapshot stale — no browser session",
    data: { elements: [] as unknown[] },
  };

  return new Response(JSON.stringify(rewritten), {
    // Keep 200 so existing callers that branch only on `success` boolean
    // continue to read the body; the `code` field is the canonical signal.
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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

  // Pre-process: short-circuit routes the SDK would 404 on. We surface a
  // structured 503 NO_BROWSER_CONNECTED instead of a bare 404 so callers
  // reading `success`/`code` (page-health probes, runner SDK shims,
  // multi-tab debug UI) get a meaningful signal. The check is derived from
  // UI_BRIDGE_ROUTES + the relay-transport set — no hardcoded allow-list,
  // so the proxy auto-tracks new SDK routes as the SDK ships them.
  if (!isKnownRoute(path, method)) {
    return noBrowserResponse(path);
  }

  // Pre-process: short-circuit registry-backed routes when no browser is
  // connected. These routes (currently `GET /control/components`) read
  // from a server-side registry populated by browser-side SDK calls; with
  // no relay client attached the registry is always empty and the SDK
  // returns `success:true, data:{components:[]}` — indistinguishable
  // from "browser connected, no components registered". Mirror the
  // unknown-route gate so callers reading `success`/`code` get a
  // structured `NO_BROWSER_CONNECTED` 503 instead.
  if (isBrowserRegistryRoute(path, method) && noRelayClientsConnected()) {
    return noBrowserResponse(path);
  }

  // Body-preservation pass-through: re-wrap any POST/PUT/PATCH so the SDK's
  // `request.json()` sees the inbound body byte-for-byte with an explicit
  // `Content-Type: application/json` header. Closes the field-strip class
  // of bug observed on Vercel deploys where e.g. a `{text:"X"}` body
  // arrived at the relay with `text` missing.
  const forwardRequest = await passThroughBody(request, method);

  const response = await handler(forwardRequest, { params: { path: params.path.join("/") } });

  // Post-process: rewrite stale+empty snapshots.
  if (method === "GET" && path === "/control/snapshot") {
    return rewriteStaleEmptySnapshot(response);
  }

  return response;
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
