/**
 * The gate every Next.js server hop to a local runner passes through.
 *
 * Plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4. The
 * runner's origin guard admits the `:3001` dev frontend to credential doors
 * only through a transitional grace. This module lets a same-origin,
 * authenticated page reach those doors through the `next dev` server instead,
 * so the grace can be retired. The runner then sees a NonBrowser call, which
 * is why every check here runs BEFORE anything is forwarded:
 *
 *   1. posture   - off in a production posture (404), unless force-enabled;
 *   2. origin    - a loopback `Host`, and an `Origin` equal to the page's own
 *                  origin (`Access-Control-Allow-Origin: *` on `/api/:path*`
 *                  in `next.config.mjs` is harmless only because of this);
 *   3. auth      - a Cognito operator bearer, verified by the UI Bridge relay's
 *                  `authenticateBridgeRequest`, used unchanged. It is
 *                  Bearer-only by design: a cookie is not a credential here,
 *                  because any other localhost page is same-site and a lax
 *                  cookie rides along on its requests. Device principals are
 *                  refused: agents call the runner directly.
 *   3b. owner    - the target runner must be one of that operator's paired
 *                  devices (`checkRunnerOwnedBy`): Host and Origin bind only
 *                  browsers, and `next dev` listens on 0.0.0.0.
 *   4. headers   - only `content-type` and `accept` are forwarded.
 *
 * The file lives outside `**\/auth*` on purpose (security-surface globs); it
 * imports the auth function, it does not change it.
 */

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import {
  isEndpointUnresolved,
  resolveServerBackendUrl,
} from "@/lib/errors/endpoint-unresolved";
import {
  authenticateBridgeRequest,
  misconfiguredResponse,
  unauthenticatedResponse,
  upstreamErrorResponse,
} from "../ui-bridge/[...path]/_auth";

/** Server kill switch / demo-box force flag for the door proxy route. */
export const RUNNER_DOOR_PROXY_FLAG = "QONTINUI_WEB_RUNNER_DOOR_PROXY";

/** Inclusive runner port range — the same bounds as the FastAPI
 * `device_bridge_ws.py` `_validate_runner_port`. */
export const RUNNER_PORT_MIN = 9876;
export const RUNNER_PORT_MAX = 9899;

/** The header the browser client names its runner's loopback port in. */
export const RUNNER_PORT_HEADER = "x-qontinui-runner-port";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Request headers a runner hop forwards. Everything else is dropped:
 * never `origin`, `sec-fetch-*`, `cookie`, `authorization` or `referer`. */
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept"] as const;

/**
 * True in a production posture. The same predicate `isAllowedOrigin` in
 * `ui-bridge/[...path]/_auth.ts` uses to separate production from the rest.
 */
export function isProductionPosture(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when the door proxy is force-enabled for a demo box. */
export function isDoorProxyForced(): boolean {
  return process.env[RUNNER_DOOR_PROXY_FLAG] === "1";
}

function json(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, code, message, error: message }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * Refusal codes are this hop's own, never the runner's `CROSS_ORIGIN_REFUSED`:
 * the browser renders that one as "the runner refused this origin, add it to
 * QONTINUI_RUNNER_ALLOWED_ORIGINS", which is the opposite of the fix here.
 */
/** The 404 a disabled hop answers with. */
export function hopDisabledResponse(): Response {
  return json(
    404,
    "RUNNER_HOP_DISABLED",
    `Runner hops are off in a production posture; set ${RUNNER_DOOR_PROXY_FLAG}=1 to enable them on a demo box`
  );
}

/**
 * `host` without its port, lower-cased; `[::1]` keeps its brackets. Anything
 * that is not a plain `name[:port]` / `[v6][:port]` (userinfo, a path, a
 * second colon) yields "" and so never reads as loopback.
 */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/.exec(h);
  return m ? m[1]! : "";
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Step 2: the loopback-Host and same-origin check. Returns a refusal, or null
 * when the request may proceed. Runs before auth and before any forwarding.
 *
 * `allowAnyHost` skips the loopback-Host rule (the force flag, for a demo box
 * served on a real hostname); the same-origin rule always applies.
 */
export function checkSameOrigin(
  request: NextRequest,
  method: string,
  { allowAnyHost = false }: { allowAnyHost?: boolean } = {}
): Response | null {
  const host = request.headers.get("host");
  if (!host) {
    return json(
      403,
      "RUNNER_HOP_HOST_NOT_LOOPBACK",
      "Runner hops need a Host header"
    );
  }
  if (!allowAnyHost && !LOOPBACK_HOSTNAMES.has(hostnameOf(host))) {
    return json(
      403,
      "RUNNER_HOP_HOST_NOT_LOOPBACK",
      `Runner hops are served only on a loopback host (got ${hostnameOf(host)}); set ${RUNNER_DOOR_PROXY_FLAG}=1 on a demo box`
    );
  }

  const ownOrigin = `${request.nextUrl.protocol}//${host.toLowerCase()}`;
  const origin = request.headers.get("origin");
  if (origin === null) {
    // A browser omits Origin on a same-origin GET; a state-changing request
    // without one is not one this page made.
    if (STATE_CHANGING.has(method)) {
      return json(
        403,
        "RUNNER_HOP_CROSS_ORIGIN_REFUSED",
        `A ${method} runner hop needs an Origin header`
      );
    }
  } else if (origin.toLowerCase() !== ownOrigin) {
    return json(
      403,
      "RUNNER_HOP_CROSS_ORIGIN_REFUSED",
      `Runner hops accept only this page's own origin (${ownOrigin}); refused ${origin}`
    );
  }

  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return json(
      403,
      "RUNNER_HOP_CROSS_ORIGIN_REFUSED",
      `Runner hops accept only same-origin requests (Sec-Fetch-Site: ${site})`
    );
  }
  return null;
}

/** An authenticated operator, or the response to send instead. */
export type OperatorAuth =
  | { ok: true; userId: string; token: string }
  | { ok: false; response: Response };

/**
 * Step 3: a Cognito operator bearer. `authenticateBridgeRequest` is called
 * unchanged and its three states are kept: unauthenticated is a 401, an
 * upstream error passes through with its real status, a misconfigured
 * deployment is a 503. A device principal is a 403.
 */
export async function authenticateOperator(
  request: NextRequest
): Promise<OperatorAuth> {
  const auth = await authenticateBridgeRequest(request);
  if (!auth.ok) {
    if (auth.reason === "misconfigured") {
      return { ok: false, response: misconfiguredResponse(auth.error) };
    }
    return {
      ok: false,
      response:
        auth.reason === "upstream_error"
          ? upstreamErrorResponse(auth)
          : unauthenticatedResponse(),
    };
  }
  if (auth.kind !== "user") {
    return {
      ok: false,
      response: json(
        403,
        "RUNNER_HOP_OPERATOR_SESSION_REQUIRED",
        "Runner hops admit an operator session only; a device token calls the runner directly"
      ),
    };
  }
  return { ok: true, userId: auth.userId, token: auth.token };
}

/** Step 4: the only request headers a runner hop forwards. */
export function forwardedRequestHeaders(request: NextRequest): Headers {
  const out = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

/**
 * The runner port named in {@link RUNNER_PORT_HEADER}, or null when it is
 * absent, not a plain integer, or outside the runner range.
 */
export function runnerPortOf(request: NextRequest): number | null {
  const raw = request.headers.get(RUNNER_PORT_HEADER);
  if (raw === null || !/^\d{1,5}$/.test(raw.trim())) return null;
  const port = Number(raw.trim());
  return port >= RUNNER_PORT_MIN && port <= RUNNER_PORT_MAX ? port : null;
}

/** The 400 for a missing or out-of-range runner port. */
export function badRunnerPortResponse(): Response {
  return json(
    400,
    "RUNNER_PORT_INVALID",
    `${RUNNER_PORT_HEADER} must be a runner port in ${RUNNER_PORT_MIN}-${RUNNER_PORT_MAX}`
  );
}

/** Positive ownership verdicts, keyed on sha256(token) + runner device id. */
const ownershipCache = new Map<string, number>();
const OWNERSHIP_TTL_MS = 30_000;
/** Sized against the tail, not the median: a loaded box has answered the
 * runner's /health in up to ~10 s. */
const OWNERSHIP_PROBE_TIMEOUT_MS = 15_000;

/** Test hook: clear the ownership cache. */
export function __resetRunnerOwnershipCache(): void {
  ownershipCache.clear();
}

function readDeviceId(body: unknown): string | null {
  const data =
    body && typeof body === "object"
      ? (body as { data?: unknown }).data
      : undefined;
  const id =
    data && typeof data === "object"
      ? (data as { device_id?: unknown }).device_id
      : undefined;
  return typeof id === "string" && id.length > 0 ? id.toLowerCase() : null;
}

/**
 * Step 3b: the runner at `runnerBase` must be paired to the operator whose
 * bearer this is. The Host and Origin checks only bind BROWSERS: a script on
 * another machine can reach a `next dev` bound to 0.0.0.0 and forge both. The
 * runner then sees this hop as a local NonBrowser caller, so without this
 * check any account on the configured backend could drive the operator's
 * runner doors. The runner names itself (`GET /settings/device-info`, not a
 * door) and the backend lists the caller's own devices (`GET /api/v1/devices`
 * under the caller's bearer); the hop proceeds only on a match.
 */
export async function checkRunnerOwnedBy(
  runnerBase: string,
  token: string
): Promise<Response | null> {
  let deviceId: string | null;
  try {
    const resp = await fetch(`${runnerBase}/settings/device-info`, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(OWNERSHIP_PROBE_TIMEOUT_MS),
    });
    deviceId = resp.ok ? readDeviceId(await resp.json()) : null;
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return json(
        504,
        "RUNNER_HOP_OWNERSHIP_TIMEOUT",
        `The runner at ${runnerBase} did not name its device within ${OWNERSHIP_PROBE_TIMEOUT_MS / 1000}s`
      );
    }
    return json(
      502,
      "RUNNER_UNREACHABLE",
      `Runner not reachable at ${runnerBase}`
    );
  }
  if (deviceId === null) {
    return json(
      403,
      "RUNNER_HOP_RUNNER_UNPAIRED",
      "The runner did not name a paired device, so it cannot be proven to be yours; pair it with your account first"
    );
  }

  const key = `${createHash("sha256").update(token).digest("hex")}|${deviceId}`;
  const cachedUntil = ownershipCache.get(key);
  if (cachedUntil !== undefined && cachedUntil > Date.now()) return null;

  let base: string;
  try {
    base = resolveServerBackendUrl();
  } catch (err) {
    if (!isEndpointUnresolved(err)) throw err;
    return misconfiguredResponse(err);
  }
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/v1/devices`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return upstreamErrorResponse({ status: 503, retryAfter: null });
  }
  if (resp.status === 429 || resp.status >= 500) {
    return upstreamErrorResponse({
      status: resp.status,
      retryAfter: resp.headers.get("retry-after"),
    });
  }
  if (resp.status === 401 || resp.status === 403) {
    return unauthenticatedResponse();
  }
  let rows: unknown;
  try {
    rows = resp.ok ? await resp.json() : null;
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) {
    return json(
      502,
      "RUNNER_HOP_OWNERSHIP_UNKNOWN",
      `The device list did not answer (${resp.status}), so runner ownership is unknown`
    );
  }
  const owned = rows.some(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof (r as { id?: unknown }).id === "string" &&
      (r as { id: string }).id.toLowerCase() === deviceId
  );
  if (!owned) {
    return json(
      403,
      "RUNNER_HOP_RUNNER_NOT_OWNED",
      "This runner is not one of your paired devices"
    );
  }
  ownershipCache.set(key, Date.now() + OWNERSHIP_TTL_MS);
  return null;
}

/**
 * Steps 1-3b for a Next route that already hopped to the runner before the
 * door proxy existed (`/api/vga/capture`, `/api/vga/monitors`), under the same
 * posture rule as the door proxy minus its force flag: posture, origin, operator auth, then the
 * runner's base (resolved only once the hop is known to be on) and its owner.
 * Returns the base to forward to, or the response to send instead.
 */
export async function gateExistingRunnerHop(
  request: NextRequest,
  resolveBase: () => string | Response
): Promise<{ base: string } | { response: Response }> {
  // The door proxy's force flag does NOT apply here (plan Phase 4): these
  // hops are off in a production posture and always loopback-Host only.
  if (isProductionPosture()) return { response: hopDisabledResponse() };
  const refused = checkSameOrigin(request, request.method.toUpperCase());
  if (refused) return { response: refused };
  const auth = await authenticateOperator(request);
  if (!auth.ok) return { response: auth.response };
  const base = resolveBase();
  if (typeof base !== "string") return { response: base };
  const notOwned = await checkRunnerOwnedBy(base, auth.token);
  return notOwned ? { response: notOwned } : { base };
}
