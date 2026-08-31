/**
 * Minimal helper to GET a path on a paired runner through the web backend's
 * device-bridge runner-proxy (`/api/v1/device-bridge/runner-proxy/{path}`).
 *
 * The proxy tunnels HTTP→WebSocket to the runner identified by the
 * `X-Qontinui-Device-Id` header (cloud relay), or to a co-located localhost
 * runner when the header is absent. It accepts arbitrary safe paths, so the
 * runner's Spec API and the live UI Bridge snapshot are both reachable with no
 * new backend code. Mirrors the relay-call idiom in `lib/co-pilot/planClient.ts`.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const RUNNER_PROXY_PREFIX = "/api/v1/device-bridge/runner-proxy/";
const DEVICE_ID_HEADER = "X-Qontinui-Device-Id";

/**
 * The additive diagnostic fields the backend puts on a relay 404/503 body.
 *
 * The relay's 503 (`ws_session_id IS NULL` — the runner never registered with
 * the backend) and its 404 (wrong/unowned device id) both carry these beyond
 * their fixed `detail`. Reading them is the whole point of the backend
 * emitting them: without this, a relay failure surfaced here as the bare
 * string "runner returned HTTP 503" and the diagnosis had to start from the
 * server logs with no id to grep for.
 */
export interface RunnerRelayDiagnostics {
  /** Fixed per status — `"runner not connected"` on the 503. */
  detail?: string;
  deviceId?: string;
  /**
   * When the runner last held a WS session — the clock that tells "never
   * registered" apart from "flapping right now". `lastSeenAt` is the general
   * device heartbeat and does not.
   *
   * Three states, and the difference between the last two matters:
   *  - a string  — it held a session until then, so it is flapping, not absent;
   *  - `null`    — the column is NULL: it has **never** registered;
   *  - `undefined` — **unknown**. The backend omits the key when its coord
   *    read failed (and an older backend never sent it at all). Not a
   *    synonym for `null`: reporting "never registered" because a lookup
   *    failed is a confident wrong answer, which is the failure mode this
   *    whole diagnostic path exists to remove.
   */
  wsConnectedAt?: string | null;
  /** The device heartbeat clock. Same three states as `wsConnectedAt`. */
  lastSeenAt?: string | null;
  /**
   * Correlates with the backend's `X-Request-ID` for this request and with
   * every structured log line it emitted — grep the server logs for it.
   */
  requestId?: string;
}

export class RunnerRelayError extends Error {
  readonly detail?: string;
  readonly deviceId?: string;
  readonly wsConnectedAt?: string | null;
  readonly lastSeenAt?: string | null;
  readonly requestId?: string;

  constructor(
    message: string,
    readonly status?: number,
    diagnostics: RunnerRelayDiagnostics = {}
  ) {
    super(message);
    this.name = "RunnerRelayError";
    this.detail = diagnostics.detail;
    this.deviceId = diagnostics.deviceId;
    this.wsConnectedAt = diagnostics.wsConnectedAt;
    this.lastSeenAt = diagnostics.lastSeenAt;
    this.requestId = diagnostics.requestId;
  }
}

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

const asNullableString = (v: unknown): string | null | undefined =>
  v === null ? null : asString(v);

/**
 * Pull the diagnostic fields off an error response.
 *
 * Every field is optional and independently guarded: the body may not be JSON
 * at all (a proxy's HTML error page), and an older backend predates these
 * fields entirely. A body we cannot read degrades to no diagnostics — never to
 * a thrown parse error that would replace the real HTTP failure with a
 * misleading one.
 */
async function readDiagnostics(
  resp: Response
): Promise<RunnerRelayDiagnostics> {
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null) return {};
  const b = body as Record<string, unknown>;
  return {
    detail: asString(b.detail),
    deviceId: asString(b.device_id),
    wsConnectedAt: asNullableString(b.ws_connected_at),
    lastSeenAt: asNullableString(b.last_seen_at),
    // Fall back to the header, which `RequestIDMiddleware` sets on every
    // response whether or not the handler put the id in the body.
    requestId:
      asString(b.request_id) ?? asString(resp.headers.get("X-Request-ID")),
  };
}

/**
 * GET `runnerPath` (e.g. `apps/qontinui-web/spec/list`) on `deviceId`'s runner
 * via the relay and parse the JSON body. Throws {@link RunnerRelayError} on a
 * transport failure or non-2xx so React Query surfaces it as an error state.
 */
export async function runnerProxyGet<T>(
  deviceId: string,
  runnerPath: string,
  opts?: { timeoutMs?: number }
): Promise<T> {
  const path = runnerPath.replace(/^\//, "");
  const headers: Record<string, string> = { [DEVICE_ID_HEADER]: deviceId };
  if (opts?.timeoutMs)
    headers["X-Qontinui-Timeout-Ms"] = String(opts.timeoutMs);

  let resp: Response;
  try {
    resp = await httpClient.fetch(
      `${ApiConfig.API_BASE_URL}${RUNNER_PROXY_PREFIX}${path}`,
      { method: "GET", headers, maxRetries: 0 }
    );
  } catch (err) {
    throw new RunnerRelayError(
      err instanceof Error ? err.message : "runner not reachable"
    );
  }
  if (!resp.ok) {
    const diagnostics = await readDiagnostics(resp);
    // Put `detail` and the request id in the message itself: this string is
    // what React Query surfaces and what lands in the console, and the id is
    // only useful if the person reading it can see it.
    const because = diagnostics.detail ? `: ${diagnostics.detail}` : "";
    const ref = diagnostics.requestId
      ? ` (request ${diagnostics.requestId})`
      : "";
    throw new RunnerRelayError(
      `runner returned HTTP ${resp.status} for ${path}${because}${ref}`,
      resp.status,
      diagnostics
    );
  }
  return (await resp.json()) as T;
}
