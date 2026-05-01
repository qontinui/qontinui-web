/**
 * Server-side store for real-world grounding captures.
 *
 * Mirrors the /bbox and /screenshot ring-buffers but stores the combined
 * (screenshot + element-list) payload the capture-host emits when driven
 * over a real qontinui-web page (not the synthetic /api/grounding-isolated
 * iframe). Used by `capture_grounding_real.py` to build a real-world eval
 * set that tests whether the model transfers from synthetic isolated
 * renders to multi-element product UI.
 */

import { type NextRequest, NextResponse } from "next/server";

interface PageElement {
  tag: string;
  role: string;
  text: string;
  bbox: [number, number, number, number];
}

interface StoredPage {
  key: string;
  url: string;
  png: Buffer;
  width: number;
  height: number;
  elements: PageElement[];
  receivedAt: number;
}

const MAX_ENTRIES = 64;

const store: Map<string, StoredPage> =
  (
    globalThis as unknown as {
      __groundingPageCaptureStore?: Map<string, StoredPage>;
    }
  ).__groundingPageCaptureStore ??
  ((
    globalThis as unknown as {
      __groundingPageCaptureStore?: Map<string, StoredPage>;
    }
  ).__groundingPageCaptureStore = new Map<string, StoredPage>());

function evictOldest(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = String(body?.url ?? "");
    const key = String(body?.key ?? url);
    const width = Number(body?.width ?? 0);
    const height = Number(body?.height ?? 0);
    const elements = Array.isArray(body?.elements) ? body.elements : [];
    const dataUrl = String(body?.dataUrl ?? "");
    const match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/i);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: "dataUrl missing or invalid" },
        { status: 400 }
      );
    }
    const png = Buffer.from(match[1]!, "base64");

    store.delete(key);
    store.set(key, {
      key,
      url,
      png,
      width,
      height,
      elements: elements.map((e: Record<string, unknown>) => ({
        tag: String(e.tag ?? ""),
        role: String(e.role ?? e.tag ?? ""),
        text: String(e.text ?? "").slice(0, 80),
        bbox: Array.isArray(e.bbox)
          ? e.bbox.slice(0, 4).map(Number)
          : [0, 0, 0, 0],
      })) as PageElement[],
      receivedAt: Date.now(),
    });
    evictOldest();
    return NextResponse.json({
      ok: true,
      stored: key,
      elements: elements.length,
      bytes: png.byteLength,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "invalid payload" },
      { status: 400 }
    );
  }
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  const url = request.nextUrl.searchParams.get("url");
  const wantPng = request.nextUrl.searchParams.get("format") === "png";

  if (!key && !url) {
    return NextResponse.json({
      ok: true,
      count: store.size,
      entries: Array.from(store.values()).map((e) => ({
        key: e.key,
        url: e.url,
        width: e.width,
        height: e.height,
        elements: e.elements.length,
        bytes: e.png.byteLength,
        receivedAt: e.receivedAt,
      })),
    });
  }

  const lookup = key ?? url!;
  const entry = store.get(lookup);
  if (!entry) {
    return NextResponse.json({ ok: false, found: false }, { status: 404 });
  }

  if (wantPng) {
    return new NextResponse(new Uint8Array(entry.png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(entry.png.byteLength),
        "X-Capture-Width": String(entry.width),
        "X-Capture-Height": String(entry.height),
        "X-Capture-Elements": String(entry.elements.length),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    found: true,
    key: entry.key,
    url: entry.url,
    width: entry.width,
    height: entry.height,
    elements: entry.elements,
    bytes: entry.png.byteLength,
    receivedAt: entry.receivedAt,
  });
}
