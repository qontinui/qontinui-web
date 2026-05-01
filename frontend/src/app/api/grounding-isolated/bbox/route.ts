/**
 * Server-side signal channel for the capture-host iframe pattern.
 *
 * Why this exists: the iframe → parent postMessage path fails when the
 * host tab is backgrounded (Chrome throttles RAF and defers some iframe
 * scripts). This gives us a tab-focus-independent way to relay the
 * iframe's measured bbox back to the capture driver.
 *
 * Flow:
 *   - The `/api/grounding-isolated` iframe, after rendering, POSTs its
 *     bbox here (keyed by `sampleIndex`).
 *   - The external capture driver polls GET `?sampleIndex=N` to retrieve.
 *
 * Only the latest N=256 entries are retained (FIFO eviction) so the
 * process doesn't leak memory over long capture runs.
 */

import { type NextRequest, NextResponse } from "next/server";

interface StoredBbox {
  sampleIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  component: string | null;
  variant: string | null;
  receivedAt: number;
}

const MAX_ENTRIES = 256;
// Module-level ring buffer — persists across requests for the life of the
// Next.js process (or until HMR reloads this module).
const store: Map<number, StoredBbox> =
  (globalThis as unknown as { __groundingBboxStore?: Map<number, StoredBbox> })
    .__groundingBboxStore ??
  ((
    globalThis as unknown as { __groundingBboxStore?: Map<number, StoredBbox> }
  ).__groundingBboxStore = new Map<number, StoredBbox>());

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
    const bbox: StoredBbox = {
      sampleIndex: Number(body?.sampleIndex ?? -1),
      x: Number(body?.x ?? 0),
      y: Number(body?.y ?? 0),
      width: Number(body?.width ?? 0),
      height: Number(body?.height ?? 0),
      viewportWidth: Number(body?.viewportWidth ?? 0),
      viewportHeight: Number(body?.viewportHeight ?? 0),
      component: (body?.component as string | undefined) ?? null,
      variant: (body?.variant as string | undefined) ?? null,
      receivedAt: Date.now(),
    };
    // Re-insert to keep insertion-order-based eviction correct.
    store.delete(bbox.sampleIndex);
    store.set(bbox.sampleIndex, bbox);
    evictOldest();
    return NextResponse.json({ ok: true, stored: bbox.sampleIndex });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "invalid body" },
      { status: 400 }
    );
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("sampleIndex");
  if (raw === null) {
    // No sampleIndex — return the full set of stored entries (debug).
    return NextResponse.json({
      ok: true,
      count: store.size,
      entries: Array.from(store.values()),
    });
  }
  const sampleIndex = Number.parseInt(raw, 10);
  if (!Number.isFinite(sampleIndex)) {
    return NextResponse.json(
      { ok: false, error: "invalid sampleIndex" },
      { status: 400 }
    );
  }
  const bbox = store.get(sampleIndex);
  return NextResponse.json({ ok: true, found: !!bbox, bbox: bbox ?? null });
}
