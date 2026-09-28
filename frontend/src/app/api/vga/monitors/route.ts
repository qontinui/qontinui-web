/**
 * GET /api/vga/monitors
 *
 * Thin proxy to the runner's GET /vga/monitors endpoint. Returns the
 * monitor list as JSON.
 */

import { NextResponse } from "next/server";
import { runnerBaseOrResponse } from "../_runner-base";

export async function GET() {
  const base = runnerBaseOrResponse();
  if (base instanceof NextResponse) return base;
  const url = `${base}/vga/monitors`;

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
