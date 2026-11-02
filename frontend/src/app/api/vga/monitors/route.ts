/**
 * GET /api/vga/monitors
 *
 * Thin proxy to the runner's GET /vga/monitors endpoint. Returns the
 * monitor list as JSON.
 *
 * Gated like every Next server hop to a runner
 * (`app/api/_runner-hop/bridge-session.ts`): off in a production posture,
 * same-origin on a loopback host only, and an operator bearer required.
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
  const url = `${base}/vga/monitors`;

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

  try {
    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Runner returned invalid JSON", detail: (err as Error).message },
      { status: 502 }
    );
  }
}
