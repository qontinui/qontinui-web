/**
 * GET /api/vga/capture?monitor=N&region=x,y,w,h
 *
 * Thin proxy to the runner's `/vga/capture` endpoint at the base
 * `QONTINUI_RUNNER_URL` names.
 *
 * Exists so browser code in /vga/builder can call a same-origin URL
 * — the runner's CORS config is permissive for UI Bridge, but we'd
 * rather not rely on that for new product surfaces.
 */

import { NextResponse, type NextRequest } from "next/server";
import { runnerBaseOrResponse } from "../_runner-base";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const base = runnerBaseOrResponse();
  if (base instanceof NextResponse) return base;
  const url = `${base}/vga/capture${qs ? `?${qs}` : ""}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
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
