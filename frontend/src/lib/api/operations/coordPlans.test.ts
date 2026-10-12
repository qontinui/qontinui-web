import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the exact request each `/operations/plans*` client function sends —
 * the literal relative URL and the full `httpClient.fetch` init — and how it
 * parses the answer.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchPlan,
  fetchPlanHistory,
  fetchPlans,
  fetchPlansOverview,
  fetchPlansThroughput,
  planRowsOf,
  transitionPlan,
} = await import("./coordPlans");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordPlans", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchPlans sends the caller's query and options and parses the page", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ work_units: [{ slug: "a" }], next_cursor: null })
    );
    const qs = new URLSearchParams({
      status: "shipped",
      exclude_slug_prefix: "shepherd-",
      limit: "500",
    });
    await expect(fetchPlans(qs, { maxRetries: 0 })).resolves.toEqual({
      work_units: [{ slug: "a" }],
      next_cursor: null,
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/plans?status=shipped&exclude_slug_prefix=shepherd-&limit=500",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchPlans with an empty query sends no `?`", async () => {
    fetchMock.mockResolvedValueOnce(json({ work_units: [] }));
    await fetchPlans(new URLSearchParams());
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/plans", { method: "GET", idempotent: true }],
    ]);
  });

  it("fetchPlans rejects a non-2xx in httpClient.get's shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"deadline","budget_ms":4000}', { status: 503 })
    );
    await expect(
      fetchPlans(new URLSearchParams({ limit: "50" }))
    ).rejects.toThrow(
      'GET /api/v1/operations/plans?limit=50 failed: 503 - {"error":"deadline","budget_ms":4000}'
    );
  });

  it("fetchPlansOverview is an idempotent GET carrying the caller's options", async () => {
    fetchMock.mockResolvedValueOnce(json({ row_count: 7 }));
    await expect(fetchPlansOverview({ maxRetries: 0 })).resolves.toEqual({
      row_count: 7,
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/plans/overview",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchPlansThroughput carries `since` and the poll options", async () => {
    fetchMock.mockResolvedValueOnce(json({ count: 0, buckets: [] }));
    await expect(
      fetchPlansThroughput(
        new URLSearchParams({ since: "2026-09-06T00:00:00Z" }),
        { maxRetries: 0 }
      )
    ).resolves.toEqual({ count: 0, buckets: [] });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/plans/throughput?since=2026-09-06T00%3A00%3A00Z",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchPlan encodes the slug and keeps the 404 the page reads as not-found", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"work_unit_not_found"}', { status: 404 })
    );
    await expect(fetchPlan("a b/c", { maxRetries: 0 })).rejects.toThrow(
      'GET /api/v1/operations/plans/a%20b%2Fc failed: 404 - {"error":"work_unit_not_found"}'
    );
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/plans/a%20b%2Fc",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchPlanHistory encodes the slug and parses the envelope", async () => {
    const body = {
      slug: "a b",
      history: [
        { to_status: "vetted", transitioned_at: "2026-10-01T00:00:00Z" },
      ],
    };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchPlanHistory("a b", { maxRetries: 0 })).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/plans/a%20b/history",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("transitionPlan is a non-idempotent POST of the request body (no 5xx replay)", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await expect(
      transitionPlan("a b", { status: "vetted", note: undefined })
    ).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/plans/a%20b/transition",
        { method: "POST", body: '{"status":"vetted"}', idempotent: false },
      ],
    ]);
  });

  it("transitionPlan sends the note and rejects a 5xx in httpClient.post's shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("lost", { status: 504 }));
    await expect(
      transitionPlan("p", { status: "blocked", note: "waiting on #12" })
    ).rejects.toThrow(
      "POST /api/v1/operations/plans/p/transition failed: 504 - lost"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/p/transition",
      {
        method: "POST",
        body: '{"status":"blocked","note":"waiting on #12"}',
        idempotent: false,
      },
    ]);
  });

  it("planRowsOf reads work_units, falls back to plans, and defaults to none", () => {
    const a = { slug: "a" } as never;
    const b = { slug: "b" } as never;
    expect(planRowsOf({ work_units: [a], plans: [b] })).toEqual([a]);
    expect(planRowsOf({ work_units: [], plans: [b] })).toEqual([]);
    expect(planRowsOf({ plans: [b] })).toEqual([b]);
    expect(planRowsOf({})).toEqual([]);
    expect(planRowsOf(null)).toEqual([]);
    expect(planRowsOf(undefined)).toEqual([]);
  });
});
