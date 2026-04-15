/**
 * Server-side screenshot channel for the capture-host iframe pattern.
 *
 * Chromium aggressively throttles backgrounded tabs, so `mss` screen-
 * capture of the monitor hosting the browser shows whatever else is in
 * front of the capture tab — not the iframe content. This endpoint gives
 * us a tab-focus-independent path: the iframe uses `html2canvas` to
 * render its own DOM into a PNG blob and POSTs it here, keyed by
 * `sampleIndex`.
 *
 * FIFO eviction at N=64 (images are large; keep the buffer small).
 */

import { type NextRequest, NextResponse } from "next/server";

interface StoredScreenshot {
  sampleIndex: number;
  png: Buffer;
  width: number;
  height: number;
  receivedAt: number;
}

const MAX_ENTRIES = 64;
const store: Map<number, StoredScreenshot> = (
  globalThis as unknown as {
    __groundingScreenshotStore?: Map<number, StoredScreenshot>;
  }
).__groundingScreenshotStore ??
(((globalThis as unknown as {
  __groundingScreenshotStore?: Map<number, StoredScreenshot>;
}).__groundingScreenshotStore = new Map<number, StoredScreenshot>()));

function evictOldest(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ct = request.headers.get("content-type") ?? "";
    let png: Buffer;
    let sampleIndex = -1;
    let width = 0;
    let height = 0;

    if (ct.includes("application/json")) {
      // Data-URL payload form.
      const body = await request.json();
      sampleIndex = Number(body?.sampleIndex ?? -1);
      width = Number(body?.width ?? 0);
      height = Number(body?.height ?? 0);
      const dataUrl = String(body?.dataUrl ?? "");
      const match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/i);
      if (!match) {
        return NextResponse.json(
          { ok: false, error: "dataUrl missing or invalid" },
          { status: 400 },
        );
      }
      png = Buffer.from(match[1], "base64");
    } else {
      // Binary blob form.
      sampleIndex = Number(
        request.nextUrl.searchParams.get("sampleIndex") ?? "-1",
      );
      width = Number(request.nextUrl.searchParams.get("width") ?? "0");
      height = Number(request.nextUrl.searchParams.get("height") ?? "0");
      const buf = await request.arrayBuffer();
      png = Buffer.from(buf);
    }

    store.delete(sampleIndex);
    store.set(sampleIndex, {
      sampleIndex,
      png,
      width,
      height,
      receivedAt: Date.now(),
    });
    evictOldest();
    return NextResponse.json({
      ok: true,
      stored: sampleIndex,
      bytes: png.byteLength,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "invalid payload" },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("sampleIndex");
  if (raw === null) {
    return NextResponse.json({
      ok: true,
      count: store.size,
      entries: Array.from(store.values()).map((e) => ({
        sampleIndex: e.sampleIndex,
        width: e.width,
        height: e.height,
        bytes: e.png.byteLength,
        receivedAt: e.receivedAt,
      })),
    });
  }
  const sampleIndex = Number.parseInt(raw, 10);
  if (!Number.isFinite(sampleIndex)) {
    return NextResponse.json(
      { ok: false, error: "invalid sampleIndex" },
      { status: 400 },
    );
  }
  const shot = store.get(sampleIndex);
  if (!shot) {
    return NextResponse.json({ ok: false, found: false }, { status: 404 });
  }
  // Return raw PNG so the capture driver can save bytes straight through.
  return new NextResponse(new Uint8Array(shot.png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(shot.png.byteLength),
      "X-Sample-Index": String(shot.sampleIndex),
      "X-Sample-Width": String(shot.width),
      "X-Sample-Height": String(shot.height),
    },
  });
}
