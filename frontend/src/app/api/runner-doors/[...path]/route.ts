/**
 * Same-origin runner door proxy. All logic, and the order of its checks, is in
 * `app/api/_runner-hop/door-proxy.ts` (a route file may export only handlers).
 */

import type { NextRequest } from "next/server";
import { handleRunnerDoorRequest } from "../../_runner-hop/door-proxy";

type NextContext = { params: Promise<{ path: string[] }> };

async function handle(
  request: NextRequest,
  context: NextContext,
  method: string
): Promise<Response> {
  const { path } = await context.params;
  return handleRunnerDoorRequest(request, path ?? [], method);
}

export async function GET(request: NextRequest, context: NextContext) {
  return handle(request, context, "GET");
}

export async function POST(request: NextRequest, context: NextContext) {
  return handle(request, context, "POST");
}

export async function PUT(request: NextRequest, context: NextContext) {
  return handle(request, context, "PUT");
}

export async function DELETE(request: NextRequest, context: NextContext) {
  return handle(request, context, "DELETE");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
