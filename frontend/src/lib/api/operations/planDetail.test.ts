import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each plan-detail function: literal URL, method, body. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchPlanDetail, fetchPlanHistory, transitionPlan } =
  await import("./planDetail");

describe("planDetail", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchPlanDetail GETs /plans/{slug} (encoded) and parses the body", async () => {
    const body = { work_unit: { slug: "a b" }, recent_history: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchPlanDetail("a b")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/operations/plans/a%20b");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("fetchPlanHistory GETs /plans/{slug}/history", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ history: [] }), { status: 200 })
    );
    await expect(fetchPlanHistory("p")).resolves.toEqual({ history: [] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/operations/plans/p/history"
    );
  });

  it("transitionPlan POSTs the status and note", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await transitionPlan("p", { status: "shipped", note: "done" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/p/transition",
      {
        method: "POST",
        body: JSON.stringify({ status: "shipped", note: "done" }),
      },
    ]);
  });

  it("a non-2xx rejects in the helpers' shape with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"work_unit_not_found"}', { status: 404 })
    );
    const err = await fetchPlanDetail("typo").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/plans/typo failed: 404 - {"error":"work_unit_not_found"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });
});
