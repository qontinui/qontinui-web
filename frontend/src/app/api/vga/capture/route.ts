/**
 * GET /api/vga/capture?monitor=N&region=x,y,w,h
 *
 * Thin proxy to the runner's capture endpoint at
 *   http://localhost:9876/vga/capture
 *
 * Exists so browser code in /vga/builder can call a same-origin URL
 * — the runner's CORS config is permissive for UI Bridge, but we'd
 * rather not rely on that for new product surfaces.
 */

import { NextResponse, type NextRequest } from "next/server";

const RUNNER_BASE = process.env.QONTINUI_RUNNER_URL ?? "http://localhost:9876";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${RUNNER_BASE}/vga/capture${qs ? `?${qs}` : ""}`;

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
