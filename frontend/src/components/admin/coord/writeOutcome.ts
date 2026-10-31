/**
 * Did a failed write to coord through the web proxy possibly land?
 *
 * One rule for every surface that has to answer: a write the answer leaves open
 * is UNKNOWN until a re-read settles it, never a refusal that invites a blind
 * retry. `httpStatusOf` says what status came back; this says what that status
 * means for a WRITE through these proxies.
 */

import { NO_CONNECTION_MESSAGE } from "@/services/http-client";
import { httpBodyOf, httpStatusOf } from "./httpStatus";

/**
 * The web proxies' exact detail for a connect failure — a 502 that proves coord
 * never saw the request (`_proxy_coord_write`, `_coord_request`). It proves
 * that of the attempt it answers, so the writes classified here are sent once
 * (`maxRetries: 0`): an earlier attempt's lost 504 cannot hide behind it.
 */
export const PROXY_NOT_REACHABLE_DETAIL = "coord is not reachable";

/**
 * How the registry door's deploy-order 502 begins
 * (`_coord_request_deploy_order_aware`): coord answered an EMPTY 404, i.e. the
 * route is not deployed, so nothing was written. The rest of the detail names
 * the route and the remedy ("deploy qontinui-coord first"), which a caller
 * shows as it came.
 */
export const PROXY_ROUTE_ABSENT_PREFIX = "coord does not serve ";

/**
 * A status after which the write may or may not have been applied.
 *
 * 500, 503 and 504 are unknown: coord's own 5xx, an intermediary's, or the
 * proxy's timeout / lost answer can all follow a commit. A 502 is "not applied"
 * ONLY when it is one of the proxy's own two no-write answers, recognised by
 * its detail: the connect failure (exact), or the deploy-order answer for a
 * route coord does not serve (by its prefix). A 502 from a load balancer in
 * front of the web backend, or one coord forwarded, carries no such proof and
 * is unknown too. Every other 5xx,
 * including a CDN's 520/524, is unknown as well, because none of them is a
 * refusal. A 4xx is coord's or the proxy's answer about the request.
 */
export function isOutcomeUnknownStatus(
  status: number,
  detail: string | null
): boolean {
  if (status === 502) {
    return !(
      detail === PROXY_NOT_REACHABLE_DETAIL ||
      (detail?.startsWith(PROXY_ROUTE_ABSENT_PREFIX) ?? false)
    );
  }
  return status >= 500;
}

/**
 * The detail the proxy gave, out of an error body: the backend's envelope
 * (`{error, message, …}`) or FastAPI's own (`{detail}`). A body that is not JSON
 * is not the proxy's, so it has none.
 */
function proxyDetailOf(body: string | null): string | null {
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const { detail, message } = parsed as { detail?: unknown; message?: unknown };
  if (typeof detail === "string") return detail;
  return typeof message === "string" ? message : null;
}

/**
 * {@link isOutcomeUnknownStatus} for what an `httpClient` write actually threw,
 * which also covers a failure with no HTTP status: a fetch that rejected says
 * nothing about whether the request reached the server, a client timeout may
 * follow a commit, and a 2xx whose body would not parse did reach it. The one
 * statusless failure kept as not sent is the browser reporting it is offline.
 */
export function isWriteFailureUnknown(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status !== null) {
    return isOutcomeUnknownStatus(status, proxyDetailOf(httpBodyOf(err)));
  }
  const message = err instanceof Error ? err.message : String(err);
  return message !== NO_CONNECTION_MESSAGE;
}
