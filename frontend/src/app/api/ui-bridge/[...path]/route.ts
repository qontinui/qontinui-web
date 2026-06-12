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
 *   404 with `{success:false, code:"UNKNOWN_ROUTE", ...}` so callers
 *   reading `success`/`code` get a structured signal that the route does
 *   not exist — deliberately distinct from `NO_BROWSER_CONNECTED` 503
 *   (browser-required route, no relay client), which this bucket was
 *   previously conflated with. Notable paths in this bucket (iter 2 +
 *   iter 4): `/ai/find` aliases, `/ai/forms` (forms live at
 *   `GET /control/forms`), `/control/page-health`, `/control/tabs`,
 *   `/sdk/*`, `/control/network/*` stub routes.
 *
 *   The proxy auto-tracks the SDK contract: when the SDK adds a route to
 *   `UI_BRIDGE_ROUTES`, the proxy stops 404-ing it and forwards instead —
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
} from "@qontinui/ui-bridge/server";
import { handlers, relay } from "@/lib/ui-bridge/relay";
import { NextRequest } from "next/server";
import { passThroughBodyWithPeek } from "./body-passthrough";
import { registrationBodyWithCallerId } from "./_caller-identity";
import {
  isBrowserRequiredRoute,
  isKnownRoute,
  noBrowserResponse,
  unknownRouteResponse,
  type HttpMethod,
} from "./_browser-required";
import {
  isWebRouteRejected,
  forbiddenWebRouteResponse,
} from "./web-forbidden-routes";
import {
  authenticateBridgeRequest,
  isAllowedOrigin,
  isAuthGateEnabled,
  originForbiddenResponse,
  unauthenticatedResponse,
} from "./_auth";
import {
  commandNameFromPath,
  deriveExecutionStatus,
  isAuditablePath,
  recordAudit,
  summarizeBody,
  tabIdFor,
  targetElementIdFor,
} from "./_audit";
import {
  checkRateLimit,
  kindForMethod,
  rateLimitedResponse,
} from "./_rate-limit";

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

// Route knowledge (`isKnownRoute` + the compiled UI_BRIDGE_ROUTES /
// relay-transport sets) lives in `./_browser-required` — a Next route
// file may not export non-handler functions, and the sibling module
// makes the unknown-route contract unit-testable.

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

  // Session-bound relay gate (Phase 1 of the production-safe UI Bridge
  // plan, §4.1 + partial §4.3). Off by default — gated by env var
  // `UI_BRIDGE_REQUIRE_AUTH=1`. Flip the flag per environment when the
  // SDK transport's Bearer hook is wired on the consumer side.
  //
  // Auth runs BEFORE the forbidden-route + isKnownRoute checks: a hostile
  // anonymous caller shouldn't be able to distinguish "valid route, you
  // can't access it" from "no such route" — both must yield the same
  // 401 without any route-existence signal.
  // `callerUserId` is the identity spliced as `X-Caller-User-Id` for tab
  // scoping. For a `user` principal it's the operator's own id; for a
  // `device` principal it's the PAIRED operator's id (resolved by
  // `/devices/me`), so a device sees the same owned-tab set as its operator.
  //
  // `callerRateLimitKey` is the rate-limit bucket key. It is NAMESPACED by
  // principal kind so a device and a user whose UUIDs collide can't share a
  // bucket: `dev:<deviceId>` for a device, the bare `userId` for a user.
  let callerUserId: string | null = null;
  let callerRateLimitKey: string | null = null;
  let callerToken: string | null = null;
  if (isAuthGateEnabled()) {
    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return originForbiddenResponse();
    }
    const auth = await authenticateBridgeRequest(request);
    if (!auth.ok) {
      return unauthenticatedResponse();
    }
    callerUserId = auth.userId;
    callerToken = auth.token;
    callerRateLimitKey =
      auth.kind === "device" ? `dev:${auth.deviceId}` : auth.userId;
  }

  // Per-principal rate limit (§4.8). Runs AFTER auth (we need a verified
  // identity to key against) and BEFORE the body-preservation pass-through
  // so the 429 path short-circuits as cheaply as possible. Only active when
  // the auth gate is on — in admin/local-dev mode there's no principal to
  // key against and the limit doesn't apply. The key is namespaced per
  // principal kind (`dev:<deviceId>` vs the bare userId) so a device gets
  // its own budget separate from its paired operator.
  //
  // The check is fail-OPEN when Redis is unreachable: `checkRateLimit`
  // returns `allowed: true, redisOffline: true` and we let the request
  // through. See `_rate-limit.ts::checkRateLimit` for the rationale.
  if (callerRateLimitKey) {
    const rl = await checkRateLimit(callerRateLimitKey, kindForMethod(method));
    if (!rl.allowed) {
      return rateLimitedResponse(rl);
    }
  }

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
  // structured 404 UNKNOWN_ROUTE instead of a bare 404 so callers reading
  // `success`/`code` (page-health probes, runner SDK shims, multi-tab
  // debug UI) get a meaningful signal — and deliberately NOT the
  // NO_BROWSER_CONNECTED 503 these paths used to get: "no such route"
  // must be distinguishable from "no browser attached". The check is
  // derived from UI_BRIDGE_ROUTES + the relay-transport set — no
  // hardcoded allow-list, so the proxy auto-tracks new SDK routes as the
  // SDK ships them.
  if (!isKnownRoute(path, method)) {
    return unknownRouteResponse(path);
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
  //
  // We use `passThroughBodyWithPeek` (a `passThroughBody` superset) so we
  // get a best-effort parsed JSON copy back on the same read — needed
  // for the audit-log safe summary in the auditable-write branch below.
  const { request: bodyPreserved, parsedBody } = await passThroughBodyWithPeek(
    request,
    method,
  );

  // Per-user tab scoping (§4.2, SDK ≥ 0.12.0): when the auth gate
  // produced an authenticated userId, splice it onto the forwarded
  // request as `X-Caller-User-Id` so the SDK relay's per-user filtering
  // path (listOwnedTabs / ownerCheck) sees it. The SDK contract requires
  // this header be set ONLY from a server-verified identity, NEVER from
  // a browser-supplied value — the auth gate above is that point of
  // verification. Header is omitted when the auth gate is off (admin
  // mode at the SDK relay: returns all tabs).
  const forwardRequest = callerUserId
    ? withCallerIdentity(bodyPreserved, parsedBody, callerUserId)
    : bodyPreserved;

  const response = await handler(forwardRequest, {
    params: { path: params.path.join("/") },
  });

  // Audit log (§4.8). Record one row per WRITE command the user issued
  // through the relay. Fire-and-forget: the `recordAudit` call doesn't
  // block the response and never throws — a failure is logged at
  // warn-level inside `recordAudit` itself. We only audit when:
  //
  //   - the auth gate is on (we need a verified userId + Bearer to write),
  //   - the (path, method) classifies as auditable (`/control/*` or
  //     `/ai/*` POST/PUT/DELETE excluding render-log + transport endpoints),
  //
  // …so reads (every GET, including `/control/snapshot` and `/tabs`) and
  // SDK transport endpoints (`/heartbeat`, `/commands`, `/commands/stream`)
  // never hit the table — keeping the activity feed about user-issued
  // commands, not the SDK's own bookkeeping.
  if (callerUserId && callerToken && isAuditablePath(path, method as HttpMethod)) {
    // Capture into a const so the async closure below sees the narrowed
    // non-null type (the `let callerToken` is reassigned above, so TS would
    // otherwise widen it back to `string | null` inside the closure).
    const auditToken = callerToken;
    const commandName = commandNameFromPath(path);
    const summary = summarizeBody(parsedBody, commandName);
    const targetElementId = targetElementIdFor(path, parsedBody);
    const tabId = tabIdFor(parsedBody, request.headers.get("x-caller-tab-id"));

    // Bug 3b: record the EXECUTION outcome, not merely receipt. `response.status`
    // is the relay-delivery status (200 once the relay accepted/delivered the
    // command to the target tab); whether the tab actually RAN it is carried in
    // the response BODY's `success`/`code`. Clone the response so reading the
    // body here does NOT consume the stream returned to the caller, and parse
    // the clone BEFORE firing the (still fire-and-forget) audit insert. Parse
    // is best-effort: a non-JSON / unreadable body falls back to `received`
    // (we never over-claim execution).
    let parsedResponse: unknown = null;
    try {
      parsedResponse = await response.clone().json();
    } catch {
      // Non-JSON or empty body → leave null → deriveExecutionStatus() returns
      // `received` (delivered, outcome unknown).
    }
    const executionStatus = deriveExecutionStatus(
      response.status,
      parsedResponse,
    );
    // Intentionally not awaited; per the spec this is fire-and-forget.
    void recordAudit({
      token: auditToken,
      sessionId: null,
      tabId,
      commandName,
      targetElementId,
      path,
      method,
      origin: request.headers.get("origin"),
      statusCode: response.status,
      executionStatus,
      payloadSummary: summary,
    });
  }

  return response;
}

/**
 * Return a fresh `NextRequest` identical to `request` but carrying the
 * server-verified caller identity in BOTH places the SDK relay keys tabs on:
 *
 *  1. `X-Caller-User-Id` header — the relay's per-user FILTER key on list
 *     (`listOwnedTabs` / `ownerCheck`).
 *  2. `registrationMetadata.userId` in the body (the SDK's register/heartbeat
 *     payload) — the relay's per-user OWNERSHIP key on register. When the body
 *     carries `registrationMetadata`, its `userId` is FORCED to the same
 *     verified id.
 *
 * Why both: the relay keys tab ownership on register by
 * `registrationMetadata.userId` (browser-supplied — it's `JWT.sub`) but filters
 * on list by `X-Caller-User-Id` (server-verified via the auth gate → the
 * backend user id). For a session whose token `sub` differs from the backend
 * user id — a Cognito operator bearer, or an email-linked account whose
 * `cognito_sub` is null — those two ids diverge, so the tab registers under one
 * id and the lookup queries another: the tab is invisible and the co-pilot
 * reports "no connected tab" forever. Forcing `registrationMetadata.userId` to
 * the verified id keeps register + list aligned, and (defense in depth) stops a
 * client from registering a tab under any other user's id.
 *
 * The original request is not mutated (Next request headers are read-only).
 */
function withCallerIdentity(
  request: NextRequest,
  parsedBody: unknown,
  userId: string
): NextRequest {
  const headers = new Headers(request.headers);
  headers.set("x-caller-user-id", userId);
  const NextRequestCtor = request.constructor as new (
    input: string | URL,
    init?: RequestInit
  ) => NextRequest;

  // If the body carries registrationMetadata, re-serialize it with the
  // verified userId. `parsedBody` is the best-effort JSON peek from
  // `passThroughBodyWithPeek` — present for the JSON POSTs that register a tab
  // (e.g. /heartbeat). A new string body means fetch must recompute the length.
  const rewrittenBody = registrationBodyWithCallerId(parsedBody, userId);
  if (rewrittenBody !== null) {
    headers.delete("content-length");
    return new NextRequestCtor(request.url, {
      method: request.method,
      headers,
      body: rewrittenBody,
    });
  }

  // No registrationMetadata to align → forward the (already re-wrapped) body
  // stream unchanged. `arrayBuffer()` was consumed by `passThroughBody` when a
  // body exists, so any body present here is the re-wrapped stream.
  return new NextRequestCtor(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // Required for Node fetch when body is a stream:
    // @ts-expect-error — duplex is a Node-only field not in the DOM Request type.
    duplex: "half",
  });
}

// `registrationBodyWithCallerId` lives in `./_caller-identity` — a Next route
// file may not export non-handler functions (fails the generated route-type
// check). It's imported at the top of this module.

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
