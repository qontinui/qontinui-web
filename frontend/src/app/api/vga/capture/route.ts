/**
 * GET /api/vga/capture?monitor=N&region=x,y,w,h
 *
 * Thin proxy to the runner's `/vga/capture` endpoint at the base
 * `QONTINUI_RUNNER_URL` names.
 *
 * Exists so browser code in /vga/builder can call a same-origin URL
 * — the runner's CORS config is permissive for UI Bridge, but we'd
 * rather not rely on that for new product surfaces.
 *
 * `GET /vga/capture` is a runner credential door, and the runner sees this
 * hop as a NonBrowser call, so the hop is gated like the runner door proxy
 * (`app/api/_runner-hop/bridge-session.ts`): off in a production posture,
 * same-origin on a loopback host only, and an operator bearer required.
 * Without that, `Access-Control-Allow-Origin: *` on `/api/:path*` let any
 * page read the operator's screen (coord finding a4ff448f).
 */

import { NextResponse, type NextRequest } from "next/server";
import { runnerBaseOrResponse } from "@/lib/errors/endpoint-response";
import {
  forwardedRequestHeaders,
  gateExistingRunnerHop,
} from "../../_runner-hop/bridge-session";

export async function GET(request: NextRequest) {
  const gate = await gateExistingRunnerHop(request, runnerBaseOrResponse);
  if ("response" in gate) return gate.response;
  const base = gate.base;
  const qs = request.nextUrl.searchParams.toString();
  const url = `${base}/vga/capture${qs ? `?${qs}` : ""}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: forwardedRequestHeaders(request),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Runner unreachable", detail: (err as Error).message },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Runner returned error",
        status: upstream.status,
        body: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") ?? "image/png";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
