import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordComputers` function's exact request: the RELATIVE URL
 * written out as a LITERAL, the `encodeURIComponent` of the path parameter,
 * and the `httpClient.fetch` options (method, retry policy, the caller's
 * options kept).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchComputer, fetchComputers } = await import("./coordComputers");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordComputers", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchComputers GETs /computers, declared idempotent, keeping the caller's options", async () => {
    fetchMock.mockResolvedValueOnce(json({ computers: [] }));
    await expect(fetchComputers({ maxRetries: 0 })).resolves.toEqual({
      computers: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/computers",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchComputer GETs the encoded computer id", async () => {
    fetchMock.mockResolvedValueOnce(json({ computer_id: "a/b #1" }));
    await fetchComputer("a/b #1");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/computers/a%2Fb%20%231",
      { method: "GET", idempotent: true },
    ]);
  });

  it("rejects a non-2xx in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "not_found" }, 404));
    const err = await fetchComputer("c1").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/computers/c1 failed: 404 - {"error":"not_found"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });
});
