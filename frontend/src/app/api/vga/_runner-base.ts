/**
 * The runner the `/api/vga/*` server-side proxies forward to.
 *
 * Resolved per request so an unset `QONTINUI_RUNNER_URL` outside development
 * answers a structured 503 naming the variable to set — `{code, endpoint,
 * env_var, error, next_action}` — instead of calling this server's own
 * loopback, which on a deployed site is not the operator's machine.
 */

import { NextResponse } from "next/server";
import {
  EndpointUnresolvedError,
  resolveEndpoint,
} from "@/lib/errors/endpoint-unresolved";

export function runnerBaseOrResponse(): string | NextResponse {
  try {
    return resolveEndpoint("runner", process.env.QONTINUI_RUNNER_URL);
  } catch (err) {
    if (err instanceof EndpointUnresolvedError) {
      return NextResponse.json(err.toBody(), { status: 503 });
    }
    throw err;
  }
}
