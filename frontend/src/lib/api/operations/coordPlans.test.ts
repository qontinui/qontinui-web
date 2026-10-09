import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordPlans` function's exact request: the RELATIVE URL written
 * out as a LITERAL, the `encodeURIComponent` of every path parameter, and the
 * `httpClient.fetch` options the route walker cannot see (method, idempotent,
 * and the caller's retry budget). Each function resolves the parsed body and
 * rejects a non-2xx in the `<METHOD> <url> failed: <status> - <body>` shape.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchDomainCost,
  fetchPlan,
  fetchPlanHistory,
  fetchPlans,
  fetchPlansOverview,
  fetchPlansThroughput,
  fetchTreesByDevice,
  fetchTreesContention,
  transitionPlan,
} = await import("./coordPlans");

/** A value that only survives the trip as one path segment if encoded. */
const RAW = "a/b #1";
const ENCODED = "a%2Fb%20%231";

const POLL = { maxRetries: 0 };

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordPlans", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "nope" }, 404));
    const err = await fetchPlan(RAW).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `GET /api/v1/operations/plans/${ENCODED} failed: 404 - {"detail":"nope"}`
    );
    expect(httpStatusOf(err)).toBe(404);
    expect(httpBodyOf(err)).toBe('{"detail":"nope"}');
  });

  it("fetchPlans GETs /plans with the caller's query", async () => {
    const body = { work_units: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    const query = new URLSearchParams({ status: "vetted", limit: "500" });
    await expect(fetchPlans(query, POLL)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans?status=vetted&limit=500",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPlansOverview GETs /plans/overview", async () => {
    fetchMock.mockResolvedValueOnce(answer({ row_count: 3 }));
    await expect(fetchPlansOverview()).resolves.toEqual({ row_count: 3 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/overview",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchPlansThroughput GETs /plans/throughput with the query", async () => {
    fetchMock.mockResolvedValueOnce(answer({ count: 0 }));
    await fetchPlansThroughput(
      new URLSearchParams({ since: "2026-09-01" }),
      POLL
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/throughput?since=2026-09-01",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPlan GETs /plans/{slug} with the slug encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ work_unit: { slug: RAW } }));
    await fetchPlan(RAW);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/plans/${ENCODED}`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchPlanHistory GETs /plans/{slug}/history with the slug encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ history: [] }));
    await fetchPlanHistory(RAW);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/plans/${ENCODED}/history`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("transitionPlan POSTs the status, not idempotent, and tolerates an empty 2xx body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(
      transitionPlan(RAW, { status: "vetted", note: undefined })
    ).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/plans/${ENCODED}/transition`,
      { method: "POST", body: '{"status":"vetted"}', idempotent: false },
    ]);
  });

  it("fetchDomainCost GETs /domain-cost", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ledger: [] }));
    await fetchDomainCost(POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/domain-cost",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchTreesByDevice GETs /trees/by-device/{device_id} with the id encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ trees: [] }));
    await fetchTreesByDevice(RAW, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/trees/by-device/${ENCODED}`,
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchTreesContention GETs /trees/contention", async () => {
    fetchMock.mockResolvedValueOnce(answer({ overlaps: [] }));
    await fetchTreesContention(POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/trees/contention",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });
});
