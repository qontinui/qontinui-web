/**
 * GET /api/vga/monitors
 *
 * Thin proxy to the runner's GET /vga/monitors endpoint. Returns the
 * monitor list as JSON.
 */

import { NextResponse } from "next/server";

const RUNNER_BASE = process.env.QONTINUI_RUNNER_URL ?? "http://localhost:9876";

export async function GET() {
  const url = `${RUNNER_BASE}/vga/monitors`;

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
