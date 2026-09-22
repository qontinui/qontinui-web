/**
 * The ONE relay client: reach a paired runner through the web backend.
 *
 * `/api/v1/device-bridge/runner-proxy/<path>` with `X-Qontinui-Device-Id`
 * (backend `device_bridge_ws.py` `runner_proxy` → `_runner_proxy_relay`) is
 * relayed HTTP-over-WebSocket down the runner's own outbound socket, so it
 * reaches the runner by DEVICE ID from any origin and any network — the
 * cross-machine door, and on a production origin the only door. The request
 * goes through the app's authenticated `httpClient` (bearer, CSRF).
 *
 * Every relay caller in the app goes through `relayRequest`: the transport
 * resolver (`runnerRequest` in ./api-client), the co-pilot planner
 * (`lib/co-pilot/planClient.ts`) and the digital-twin reads
 * (`digital-twin/_lib/runner-relay.ts`).
 *
 * The runner relays only a CLOSED list of `(method, path)` pairs
 * (qontinui-runner `src-tauri/src/mcp/relay_path_policy.rs` `RELAY_ALLOWED`);
 * anything else it answers `403 {"error": "this path is not carried by the
 * HTTP relay — …"}` (`backend_relay.rs` `http_relay_error`), which the backend
 * relays verbatim. `readRelayPathRefusal` recognises that answer so callers can
 * say "this action needs the runner on this machine" rather than "forbidden".
 * The list is deliberately NOT mirrored here — a copy would drift; the
 * runner's refusal is the authority.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

export const RUNNER_PROXY_PREFIX = "/api/v1/device-bridge/runner-proxy/";
/** Header the runner-proxy reads to relay to a specific paired runner. */
export const DEVICE_ID_HEADER = "X-Qontinui-Device-Id";
/**
 * Per-request relay wait, in ms. The backend clamps it to [1 s, 120 s] and
 * uses it instead of its 30 s default (`_resolve_relay_timeout_s`).
 */
export const RELAY_TIMEOUT_HEADER = "X-Qontinui-Timeout-Ms";

// =============================================================================
// The relay deadline — ONE concept for every relayed request
// =============================================================================

/** The backend clamps `X-Qontinui-Timeout-Ms` to this range (`_resolve_relay_timeout_s`). */
export const RELAY_MIN_WAIT_MS = 1000;
export const RELAY_MAX_WAIT_MS = 120_000;
/**
 * The shortest relay wait any request gets, whatever budget its caller sized
 * for loopback. A relayed request is an authenticated backend request, a
 * Redis-routed WebSocket hop to the runner, the runner's own loopback call and
 * the way back; a 2 s health-check budget sized for a same-machine socket
 * would time out a healthy relay. 10 s leaves that round trip several seconds
 * of headroom on a loaded backend while still failing a dead runner quickly.
 */
export const RELAY_FLOOR_WAIT_MS = 10_000;
/** The relay wait when the caller named no budget: the backend's own default. */
export const RELAY_DEFAULT_WAIT_MS = 30_000;
/**
 * The client gives up this long AFTER the relay wait, so the backend's
 * structured 504 ("runner did not respond in time") arrives before a bare
 * client abort.
 */
export const RELAY_DEADLINE_MARGIN_MS = 3000;

/**
 * The relay wait for a caller's budget: raised to RELAY_FLOOR_WAIT_MS and
 * clamped to the backend's range; RELAY_DEFAULT_WAIT_MS when there is none.
 * Always sent as `X-Qontinui-Timeout-Ms`, so the backend never silently falls
 * back to its own default under a caller that believed it had set one.
 */
export function relayWaitMs(budgetMs?: number): number {
  if (budgetMs === undefined || !Number.isFinite(budgetMs)) {
    return RELAY_DEFAULT_WAIT_MS;
  }
  return Math.min(
    RELAY_MAX_WAIT_MS,
    Math.max(RELAY_MIN_WAIT_MS, RELAY_FLOOR_WAIT_MS, Math.round(budgetMs))
  );
}

/** The client-side deadline for a relay wait: the wait plus the margin. */
export function relayClientDeadlineMs(waitMs: number): number {
  return waitMs + RELAY_DEADLINE_MARGIN_MS;
}

export interface RelayRequestInit extends RequestInit {
  /**
   * The caller's budget. Turned into the relay wait by {@link relayWaitMs}
   * (sent as `X-Qontinui-Timeout-Ms`) and a client deadline
   * {@link RELAY_DEADLINE_MARGIN_MS} beyond it.
   */
  timeoutMs?: number;
}

/** The relay URL for a runner path (`/task-runs?limit=5` → `…/runner-proxy/task-runs?limit=5`). */
export function relayUrl(path: string): string {
  return `${ApiConfig.API_BASE_URL}${RUNNER_PROXY_PREFIX}${path.replace(/^\/+/, "")}`;
}

/**
 * A body the relay can carry as bytes with an explicit Content-Type. The
 * httpClient defaults `Content-Type: application/json`, which would strip a
 * multipart boundary from a FormData body, so non-string bodies are
 * serialized through a Request here and sent with the Content-Type the
 * browser generated for them.
 */
async function normalizeBody(
  body: BodyInit | null | undefined
): Promise<{ body?: BodyInit; contentType?: string }> {
  if (body == null || typeof body === "string") {
    return { body: body ?? undefined };
  }
  const req = new Request("http://relay.invalid/", { method: "POST", body });
  return {
    body: await req.arrayBuffer(),
    contentType: req.headers.get("content-type") ?? undefined,
  };
}

/**
 * Send one request to runner `runnerId` over the relay and return the raw
 * Response (the runner's own status and body, relayed verbatim, or the
 * backend's relay-layer status: 404 not your device, 503 not connected,
 * 504 timed out, 413 too large). Throws only when no response was received.
 */
export async function relayRequest(
  runnerId: string,
  path: string,
  init: RelayRequestInit = {}
): Promise<Response> {
  const { timeoutMs, headers: callerHeaders, body, ...rest } = init;
  const { body: relayBody, contentType } = await normalizeBody(body);
  const headers: Record<string, string> = {
    ...headersToRecord(callerHeaders),
    [DEVICE_ID_HEADER]: runnerId,
  };
  if (contentType) headers["Content-Type"] = contentType;
  const waitMs = relayWaitMs(timeoutMs);
  headers[RELAY_TIMEOUT_HEADER] = String(waitMs);
  return httpClient.fetch(relayUrl(path), {
    ...rest,
    body: relayBody,
    headers,
    // A relay failure is surfaced once: the default 5xx retry would chain
    // relay timeouts into what reads as a hang.
    maxRetries: 0,
    timeoutMs: relayClientDeadlineMs(waitMs),
  });
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

// =============================================================================
// Reading a relay answer
// =============================================================================

/**
 * The runner's relay-path refusal messages (`RelayPathVerdict::message`,
 * qontinui-runner `relay_path_policy.rs`). The runner sends no machine code in
 * the body, only these messages, so these fragments are the contract.
 */
const RELAY_PATH_REFUSAL_FRAGMENTS = [
  "not carried by the HTTP relay",
  "relay path could not be normalised",
];

/**
 * If `response` is the runner refusing a path the relay does not carry, its
 * message; otherwise null. Reads a clone, so the caller can still read the
 * body. Only a 403 can be that refusal.
 */
export async function readRelayPathRefusal(
  response: Response
): Promise<string | null> {
  if (response.status !== 403) return null;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string") return null;
  return RELAY_PATH_REFUSAL_FRAGMENTS.some((f) => error.includes(f))
    ? error
    : null;
}

/**
 * The additive diagnostic fields the backend puts on a relay 404/503 body.
 *
 * The relay's 503 (`ws_session_id IS NULL` — the runner never registered with
 * the backend) and its 404 (wrong/unowned device id) both carry these beyond
 * their fixed `detail`.
 */
export interface RunnerRelayDiagnostics {
  /** Fixed per status — `"runner not connected"` on the 503. */
  detail?: string;
  deviceId?: string;
  /**
   * When the runner last held a WS session. Three states:
   *  - a string  — it held a session until then (flapping, not absent);
   *  - `null`    — the column is NULL: it has **never** registered;
   *  - `undefined` — **unknown**: the backend omitted the key (its coord read
   *    failed, or it predates the field). Not a synonym for `null`.
   */
  wsConnectedAt?: string | null;
  /** The device heartbeat clock. Same three states as `wsConnectedAt`. */
  lastSeenAt?: string | null;
  /** The backend's `X-Request-ID` for this request — grep server logs for it. */
  requestId?: string;
}

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

const asNullableString = (v: unknown): string | null | undefined =>
  v === null ? null : asString(v);

/**
 * Pull the relay-layer diagnostic fields off an error response. Every field
 * is optional; a body that is not JSON degrades to no diagnostics (plus the
 * request id header) rather than a parse error replacing the real failure.
 * Consumes the body.
 */
export async function readRelayDiagnostics(
  resp: Response
): Promise<RunnerRelayDiagnostics> {
  const headerRequestId = asString(resp.headers.get("X-Request-ID"));
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return headerRequestId ? { requestId: headerRequestId } : {};
  }
  if (typeof body !== "object" || body === null) {
    return headerRequestId ? { requestId: headerRequestId } : {};
  }
  const b = body as Record<string, unknown>;
  return {
    detail: asString(b.detail),
    deviceId: asString(b.device_id),
    wsConnectedAt: asNullableString(b.ws_connected_at),
    lastSeenAt: asNullableString(b.last_seen_at),
    requestId: asString(b.request_id) ?? headerRequestId,
  };
}
