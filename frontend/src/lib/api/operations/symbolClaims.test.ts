import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins `fetchSymbolClaims`'s exact request: the RELATIVE URL as a LITERAL,
 * the method, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchSymbolClaims } = await import("./symbolClaims");

describe("symbolClaims", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchSymbolClaims GETs /symbol-claims with no client retries and parses the body", async () => {
    const body = { kind: "symbol", prefix: "", holders: [], truncated: false };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchSymbolClaims()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/symbol-claims",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchSymbolClaims rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 502 }));
    const err = await fetchSymbolClaims().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(502);
  });
});
