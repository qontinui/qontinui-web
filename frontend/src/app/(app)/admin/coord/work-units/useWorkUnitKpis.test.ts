/**
 * `useWorkUnitKpis` — ONE read for the visible window, and every way that read
 * can end is a state, not a number.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. Pinned:
 *   - the request is `GET /api/v1/operations/kpis?window=<w>`, once per mount —
 *     never per row, never on a timer;
 *   - a coord that does not serve the route yet (404), a transport failure and
 *     a 200 that is not a `kpis/v1` body each land as `unavailable`, with the
 *     reason, and NO index of units;
 *   - a failed RE-read over a good one keeps the good one and says it is stale;
 *   - a window change is a different question: pending until it answers, and a
 *     superseded answer never lands under the new window;
 *   - a SLUG read (the `[slug]` page) asks coord for that one unit —
 *     `?slug=<slug>`, no window — and an empty `units` is coord having no row
 *     for it, while another unit's row in the answer is a malformed reply.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { payload, unit } from "@/test/kpisFixtures";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

import {
  KPIS_ROUTE_UNAVAILABLE_TEXT,
  KPIS_SLUG_MISMATCH_REASON,
  useWorkUnitKpis,
} from "./useWorkUnitKpis";
import { KPIS_SCHEMA_MISMATCH_REASON } from "@/components/admin/coord/workUnitKpis";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useWorkUnitKpis", () => {
  it("reads once, for the window, with one request and no retries", async () => {
    fetchMock.mockResolvedValue(
      json(payload([unit("a"), unit("b"), unit("c")]))
    );
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    expect(result.current.index.state).toBe("pending");
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));

    // Three units, one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/kpis?window=28d",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect([...index.bySlug.keys()]).toEqual(["a", "b", "c"]);
    expect(index.window.days).toBe(28);
    expect(index.staleReason).toBeNull();
  });

  it("does not re-read on its own", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(json(payload([unit("a")])));
      renderHook(() => useWorkUnitKpis({ window: "28d" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lands a 404 as unavailable with the route-not-served wording and no units", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"no_such_route"}', { status: 404 })
    );
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
    expect(result.current.index).toEqual({
      state: "unavailable",
      reason: KPIS_ROUTE_UNAVAILABLE_TEXT,
    });
  });

  it("lands a transport failure as unavailable with the message", async () => {
    fetchMock.mockRejectedValue(new Error("Failed to fetch"));
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
    expect(result.current.index).toEqual({
      state: "unavailable",
      reason: "Failed to fetch",
    });
  });

  it("lands coord's 5xx as unavailable, naming the status", async () => {
    fetchMock.mockResolvedValue(
      new Response("coord is not reachable", { status: 502 })
    );
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
    const index = result.current.index;
    if (index.state !== "unavailable") throw new Error("not unavailable");
    expect(index.reason).toContain("failed: 502");
  });

  it("lands a 200 that is not kpis/v1 as unavailable — an empty list is not an answer", async () => {
    fetchMock.mockResolvedValue(json({ work_units: [] }));
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
    expect(result.current.index).toEqual({
      state: "unavailable",
      reason: KPIS_SCHEMA_MISMATCH_REASON,
    });
  });

  it("lands a partial kpis/v1 body as unavailable, not as a table with holes", async () => {
    const partial = unit("b");
    delete (partial as unknown as Record<string, unknown>).cost_microusd;
    fetchMock.mockResolvedValue(json(payload([unit("a"), partial])));
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
  });

  it("keeps the good figures when a later re-read fails, and says they are stale", async () => {
    fetchMock
      .mockResolvedValueOnce(json(payload([unit("a")])))
      .mockRejectedValueOnce(new Error("HTTP 502"));
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));

    await act(async () => {
      await result.current.refresh();
    });
    const index = result.current.index;
    if (index.state !== "loaded")
      throw new Error("blanked by a failed re-read");
    expect(index.bySlug.has("a")).toBe(true);
    expect(index.staleReason).toBe("HTTP 502");
  });

  it("clears the stale marker when a re-read succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(json(payload([unit("a")])))
      .mockRejectedValueOnce(new Error("HTTP 502"))
      .mockResolvedValueOnce(json(payload([unit("a"), unit("b")])));
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      await result.current.refresh();
    });
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect(index.staleReason).toBeNull();
    expect(index.bySlug.has("b")).toBe(true);
  });

  it("re-asks on a window change, and shows pending — not the old window — meanwhile", async () => {
    const second = deferred();
    fetchMock
      .mockResolvedValueOnce(
        json(payload([unit("a")], { window: { days: 28, from: "x", to: "y" } }))
      )
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ w }: { w: string }) => useWorkUnitKpis({ window: w }),
      { initialProps: { w: "28d" } }
    );
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));

    rerender({ w: "7d" });
    // The 28-day figures must not be shown under the 7-day heading.
    expect(result.current.index.state).toBe("pending");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/v1/operations/kpis?window=7d"
    );

    await act(async () => {
      second.resolve(
        json(payload([unit("z")], { window: { days: 7, from: "x", to: "y" } }))
      );
    });
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect(index.window.days).toBe(7);
    expect([...index.bySlug.keys()]).toEqual(["z"]);
  });

  it("drops a superseded answer instead of landing it under the new window", async () => {
    const slow = deferred();
    fetchMock
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(
        json(
          payload([unit("new")], { window: { days: 7, from: "x", to: "y" } })
        )
      );
    const { result, rerender } = renderHook(
      ({ w }: { w: string }) => useWorkUnitKpis({ window: w }),
      { initialProps: { w: "28d" } }
    );
    rerender({ w: "7d" });
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));

    // The 28d read finally answers — after the 7d one landed.
    await act(async () => {
      slow.resolve(json(payload([unit("old")])));
      await Promise.resolve();
    });
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect([...index.bySlug.keys()]).toEqual(["new"]);
  });

  it("lands nothing after unmount", async () => {
    const slow = deferred();
    fetchMock.mockReturnValueOnce(slow.promise);
    const { result, unmount } = renderHook(() =>
      useWorkUnitKpis({ window: "28d" })
    );
    unmount();
    await act(async () => {
      slow.resolve(json(payload([unit("a")])));
      await Promise.resolve();
    });
    expect(result.current.index.state).toBe("pending");
  });
});

describe("useWorkUnitKpis — a slug read", () => {
  it("asks coord for that one unit: ?slug=<slug>, no window, one request", async () => {
    fetchMock.mockResolvedValue(
      json(
        payload([unit("2026-10-01-a-plan")], {
          population: {
            shipped_units: 250,
            units_returned: 1,
            truncated: false,
          },
        })
      )
    );
    const { result } = renderHook(() =>
      useWorkUnitKpis({ slug: "2026-10-01-a-plan" })
    );
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/kpis?slug=2026-10-01-a-plan",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect(index.requestedSlug).toBe("2026-10-01-a-plan");
    expect([...index.bySlug.keys()]).toEqual(["2026-10-01-a-plan"]);
  });

  it("percent-encodes a slug rather than splicing it into the URL", async () => {
    fetchMock.mockResolvedValue(json(payload([])));
    renderHook(() => useWorkUnitKpis({ slug: "a b&window=7d" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://x");
    expect(url.searchParams.getAll("slug")).toEqual(["a b&window=7d"]);
    expect(url.searchParams.has("window")).toBe(false);
  });

  it("takes an empty units list as coord having no row — loaded, and the slug is recorded", async () => {
    fetchMock.mockResolvedValue(json(payload([])));
    const { result } = renderHook(() =>
      useWorkUnitKpis({ slug: "no-such-unit" })
    );
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect(index.bySlug.size).toBe(0);
    expect(index.requestedSlug).toBe("no-such-unit");
  });

  it("refuses a slug answer that carries a DIFFERENT unit — a malformed reply is not an absence", async () => {
    fetchMock.mockResolvedValue(json(payload([unit("someone-else")])));
    const { result } = renderHook(() =>
      useWorkUnitKpis({ slug: "2026-10-01-a-plan" })
    );
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
    expect(result.current.index).toEqual({
      state: "unavailable",
      reason: KPIS_SLUG_MISMATCH_REASON,
    });
  });

  it("does not apply that check to a window read, which legitimately returns many units", async () => {
    fetchMock.mockResolvedValue(json(payload([unit("a"), unit("b")])));
    const { result } = renderHook(() => useWorkUnitKpis({ window: "28d" }));
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));
    const index = result.current.index;
    if (index.state !== "loaded") throw new Error("not loaded");
    expect(index.requestedSlug).toBeNull();
  });

  it("treats a changed slug as a new question: pending, then the new unit", async () => {
    const second = deferred();
    fetchMock
      .mockResolvedValueOnce(json(payload([unit("first")])))
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ s }: { s: string }) => useWorkUnitKpis({ slug: s }),
      { initialProps: { s: "first" } }
    );
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));

    rerender({ s: "second" });
    // The first unit's figures must not be shown under the second's heading.
    expect(result.current.index.state).toBe("pending");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/v1/operations/kpis?slug=second"
    );
    await act(async () => {
      second.resolve(json(payload([unit("second")])));
    });
    await waitFor(() => expect(result.current.index.state).toBe("loaded"));
  });

  it("lands a 404 for a slug read as unavailable, not as 'no row'", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"no_such_route"}', { status: 404 })
    );
    const { result } = renderHook(() => useWorkUnitKpis({ slug: "a" }));
    await waitFor(() => expect(result.current.index.state).toBe("unavailable"));
    expect(result.current.index).toEqual({
      state: "unavailable",
      reason: KPIS_ROUTE_UNAVAILABLE_TEXT,
    });
  });
});
