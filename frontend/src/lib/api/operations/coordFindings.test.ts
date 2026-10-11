import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchCoordFindings } = await import("./coordFindings");

describe("coordFindings", () => {
  afterEach(() => fetchMock.mockReset());

  it("GETs /coord/findings with the query as written and resolves the body", async () => {
    const body = { findings: [] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(fetchCoordFindings("limit=50&topic=x")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/findings?limit=50&topic=x",
      { method: "GET" },
    ]);
  });

  it("rejects a non-2xx in the helpers' error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    const err = await fetchCoordFindings("limit=1").catch((e) => e);
    expect(err.message).toBe(
      "GET /api/v1/operations/coord/findings?limit=1 failed: 503 - nope"
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});
