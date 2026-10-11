import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchPlansOverview } = await import("./plansOverview");

describe("plansOverview", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchPlansOverview GETs /plans/overview with no client retries", async () => {
    const body = { derive_mode: "live" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchPlansOverview()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/overview",
      { maxRetries: 0, method: "GET" },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 503 }));
    const err = await fetchPlansOverview().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(503);
  });
});
