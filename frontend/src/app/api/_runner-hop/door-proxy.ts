/**
 * `/api/runner-doors/[...path]` — the same-origin runner door proxy.
 *
 * Plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4 (design
 * fork option D). In order, before anything is forwarded:
 *
 *   1. posture        - 404 in a production posture unless
 *                       `QONTINUI_WEB_RUNNER_DOOR_PROXY=1`;
 *   2. origin         - loopback Host (unless forced), same Origin
 *                       (./bridge-session `checkSameOrigin`);
 *   3. auth           - an operator bearer, never a cookie or a device;
 *   4. allowlist      - `RUNNER_DOOR_ROUTES` (lib/runner/door-routes); any
 *                       other route is a 404 and is never forwarded;
 *   5. target         - always `http://127.0.0.1:<port>`, the port from
 *                       `X-Qontinui-Runner-Port`, inside the runner range,
 *                       and that runner paired to this operator;
 *   6. headers        - only `content-type` and `accept`;
 *   7. response       - passed through, so the runner's typed errors reach
 *                       `readRunnerOriginRefusal` unchanged;
 *   8. rate limit and - the UI Bridge relay's per-user limit, and one local
 *      audit             `runner-door-proxy: forwarded` line per call (never a
 *                       body: it may carry API keys).
 */

import type { NextRequest } from "next/server";
import { matchRunnerDoorRoute } from "@/lib/runner/door-routes";
import {
  checkRateLimit,
  kindForMethod,
  rateLimitedResponse,
} from "../ui-bridge/[...path]/_rate-limit";
import {
  authenticateOperator,
  badRunnerPortResponse,
  checkRunnerOwnedBy,
  checkSameOrigin,
  forwardedRequestHeaders,
  hopDisabledResponse,
  isDoorProxyForced,
  isProductionPosture,
  runnerPortOf,
} from "./bridge-session";

/** Response headers passed back from the runner; the rest are dropped. */
const PASSED_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "retry-after",
] as const;

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
 * One structured line per forwarded call — the per-box record Phase 6 reads.
 * Written to the console directly rather than through `createLogger`, whose
 * `info` is fixed at module load to `next dev` only: a force-enabled
 * production build (a demo box) must still leave the record.
 */
function audit(fields: {
  userId: string;
  method: string;
  route: string;
  status: number;
  port: number;
}): void {
  // eslint-disable-next-line no-console
  console.info("[runner-door-proxy] runner-door-proxy: forwarded", fields);
}

/** `/a/b` from the catch-all segments, or null when a segment could step
 * outside the route (`.`, `..`, or one carrying a slash). */
function pathFromSegments(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (s === "" || s === "." || s === ".." || s.includes("/")) return null;
  }
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

export async function handleRunnerDoorRequest(
  request: NextRequest,
  segments: string[],
  method: string
): Promise<Response> {
  // 1. Posture.
  const forced = isDoorProxyForced();
  if (isProductionPosture() && !forced) return hopDisabledResponse();

  // 2. Loopback Host, then same-origin — before auth and before forwarding.
  const refused = checkSameOrigin(request, method, { allowAnyHost: forced });
  if (refused) return refused;

  // 3. Operator bearer.
  const auth = await authenticateOperator(request);
  if (!auth.ok) return auth.response;

  // 4. Route allowlist.
  const path = pathFromSegments(segments);
  const pattern = path === null ? null : matchRunnerDoorRoute(method, path);
  if (path === null || pattern === null) {
    return json(
      404,
      "RUNNER_DOOR_NOT_PROXIED",
      `${method} ${path ?? "(invalid path)"} is not a runner door this proxy carries`
    );
  }

  // 5. Target port.
  const port = runnerPortOf(request);
  if (port === null) return badRunnerPortResponse();

  // 8a (before any runner probe). Rate limit (fail-open when Redis is absent, as the relay's is).
  const rl = await checkRateLimit(auth.userId, kindForMethod(method));
  if (!rl.allowed) return rateLimitedResponse(rl);

  // 5b. The runner on that port must be one of this operator's paired
  // devices: Host and Origin bind only browsers (bridge-session.ts).
  const notOwned = await checkRunnerOwnedBy(
    `http://127.0.0.1:${port}`,
    auth.token
  );
  if (notOwned) return notOwned;

  // 6. Forward with only content-type and accept.
  const hasBody = method !== "GET" && method !== "HEAD";
  const target = `http://127.0.0.1:${port}${path}${request.nextUrl.search}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: forwardedRequestHeaders(request),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      // The browser giving up cancels the hop instead of leaving it waiting
      // on a runner that accepted and never answered.
      signal: request.signal,
    });
  } catch (err) {
    // The browser gave up: nobody receives an answer, and it is not a runner
    // failure, so it is not audited as one.
    if (request.signal.aborted) {
      return json(
        499,
        "RUNNER_HOP_CLIENT_CLOSED",
        "The client closed the request"
      );
    }
    audit({ userId: auth.userId, method, route: pattern, status: 502, port });
    return json(
      502,
      "RUNNER_UNREACHABLE",
      `Runner not reachable on 127.0.0.1:${port}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  audit({
    userId: auth.userId,
    method,
    route: pattern,
    status: upstream.status,
    port,
  });

  // 7. Pass the runner's answer through.
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
