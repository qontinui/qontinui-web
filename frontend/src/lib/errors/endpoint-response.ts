/**
 * Server-side half of `endpoint-unresolved`: turns an unresolved service base
 * into the structured 503 a route handler answers INSTEAD of calling a
 * dev-stack loopback — `{code, endpoint, env_var, error, next_action}`.
 *
 * Route handlers only; this imports `next/server`.
 */

import { NextResponse } from "next/server";
import {
  isEndpointUnresolved,
  resolveEndpoint,
  resolveServerBackendUrl,
  type EndpointUnresolvedError,
} from "./endpoint-unresolved";

/** The 503 a route answers for an unresolved base. */
export function endpointUnresolvedResponse(
  err: EndpointUnresolvedError
): NextResponse {
  return NextResponse.json(err.toBody(), { status: 503 });
}

/** The resolved base, or the 503 to return. Other errors propagate. */
export function endpointOrResponse(
  resolve: () => string
): string | NextResponse {
  try {
    return resolve();
  } catch (err) {
    if (isEndpointUnresolved(err)) return endpointUnresolvedResponse(err);
    throw err;
  }
}

/** Backend base for a proxying route handler (`BACKEND_URL` → `NEXT_PUBLIC_API_URL`). */
export function backendBaseOrResponse(): string | NextResponse {
  return endpointOrResponse(resolveServerBackendUrl);
}

/** Runner base for the server-side `/api/vga/*` proxies (`QONTINUI_RUNNER_URL`). */
export function runnerBaseOrResponse(): string | NextResponse {
  return endpointOrResponse(() =>
    resolveEndpoint("runner", process.env.QONTINUI_RUNNER_URL)
  );
}
