import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordPlans` function's exact request: the RELATIVE URL written
 * out as a LITERAL, the method, and the retry policy the route walker cannot
 * see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchPlansOverview, fetchPlansPage, fetchPlansThroughput, pollPlans } =
  await import("./coordPlans");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordPlans", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchPlansPage GETs /plans?<query> with the client's default retry", async () => {
    const body = { work_units: [], order: "authored_desc" };
    fetchMock.mockResolvedValueOnce(answer(body));
    const q = new URLSearchParams({ status: "shipped", limit: "500" });
    await expect(fetchPlansPage(q)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans?status=shipped&limit=500",
      { method: "GET" },
    ]);
  });

  it("pollPlans GETs /plans?<query> with no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({ plans: [] }));
    await pollPlans(new URLSearchParams({ limit: "50" }));
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans?limit=50",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("fetchPlansOverview GETs /plans/overview", async () => {
    fetchMock.mockResolvedValueOnce(answer({ row_count: 3 }));
    await expect(fetchPlansOverview()).resolves.toEqual({ row_count: 3 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/overview",
      { method: "GET" },
    ]);
  });

  it("fetchPlansThroughput GETs /plans/throughput?since= with no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({ buckets: [] }));
    await expect(fetchPlansThroughput("2026-09-06T00:00:00Z")).resolves.toEqual(
      { buckets: [] }
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/throughput?since=2026-09-06T00%3A00%3A00Z",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "deadline" }, 503));
    const err = await pollPlans(new URLSearchParams({ limit: "1" })).catch(
      (e: unknown) => e
    );
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/plans?limit=1 failed: 503 - {"error":"deadline"}'
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});
