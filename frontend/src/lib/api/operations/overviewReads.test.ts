import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `overviewReads` function's exact request: the RELATIVE URL written out as a
 * LITERAL (so a change to the shared base cannot move every expectation with
 * it), the method, the body, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => fetchMock.mockReset());

const m = await import("./overviewReads");

describe("overviewReads", () => {
  it("fetchDomainCost GETs /domain-cost with the poll options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ledger: [] }));
    await expect(m.fetchDomainCost({ maxRetries: 0 })).resolves.toEqual({
      ledger: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/domain-cost",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetDrain GETs /fleet/drain with the poll options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ drains: [] }));
    await m.fetchFleetDrain({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/drain",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchWorkUnitPlans GETs /plans with the query and rejects in the helpers error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ work_units: [] }));
    await expect(
      m.fetchWorkUnitPlans(new URLSearchParams({ limit: "500" }))
    ).resolves.toEqual({ work_units: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans?limit=500",
      { method: "GET", idempotent: true },
    ]);
    fetchMock.mockResolvedValueOnce(answer("boom", 500));
    const err = await m
      .fetchWorkUnitPlans(new URLSearchParams({ limit: "1" }))
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/plans?limit=1 failed: 500 - "boom"'
    );
    expect(httpStatusOf(err)).toBe(500);
  });
});
