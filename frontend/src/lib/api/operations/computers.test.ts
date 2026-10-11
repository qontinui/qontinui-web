import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchComputers, fetchComputer } = await import("./computers");

describe("computers", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchComputers GETs /computers with no client retries", async () => {
    const body = { computers: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchComputers()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/computers",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchComputer GETs /computers/{id} with the id encoded", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );
    await fetchComputer("a/b");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/computers/a%2Fb",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 404 }));
    const err = await fetchComputer("x").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(404);
  });
});
