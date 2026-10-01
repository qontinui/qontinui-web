/**
 * /api/endpoint-unresolved/{backend,coord}
 *
 * The destination next.config.mjs rewrites a proxy to when its upstream is
 * not configured on a non-deploy production build (config/backend-rewrite.mjs):
 * every method answers the structured 503
 * `{code: "endpoint_unresolved", endpoint, env_var, error, next_action}`
 * naming the variable to set — instead of the rewrite proxying to loopback.
 */

import { NextResponse } from "next/server";
import { endpointUnresolvedResponse } from "@/lib/errors/endpoint-response";
import { EndpointUnresolvedError } from "@/lib/errors/endpoint-unresolved";

const PROXIED = new Set(["backend", "coord"] as const);
type Proxied = "backend" | "coord";

async function answer(
  _request: Request,
  { params }: { params: Promise<{ endpoint: string }> }
): Promise<NextResponse> {
  const { endpoint } = await params;
  if (!PROXIED.has(endpoint as Proxied)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return endpointUnresolvedResponse(
    new EndpointUnresolvedError(endpoint as Proxied)
  );
}

export const GET = answer;
export const POST = answer;
export const PUT = answer;
export const PATCH = answer;
export const DELETE = answer;
export const HEAD = answer;
export const OPTIONS = answer;
