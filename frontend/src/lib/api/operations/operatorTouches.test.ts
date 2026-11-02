import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the operator-touch client sends, and its error shape. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchOperatorTouches } = await import("./operatorTouches");

const B = "/api/v1/operations";

describe("operatorTouches", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("is an idempotent relative GET carrying the query verbatim", async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"measurement":"measured"}')
    );
    await expect(
      fetchOperatorTouches("window_days=7&limit=50")
    ).resolves.toEqual({ measurement: "measured" });
    expect(fetchMock.mock.calls).toEqual([
      [
        `${B}/coord/operator-touches?window_days=7&limit=50`,
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("rejects a non-2xx with the status and coord's body", async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"error":"db_unavailable"}', { status: 503 })
    );
    await expect(fetchOperatorTouches("window_days=30")).rejects.toThrow(
      `GET ${B}/coord/operator-touches?window_days=30 failed: 503 - {"error":"db_unavailable"}`
    );
  });
});
