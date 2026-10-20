import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the verification-metrics client sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchVerificationMetrics } = await import("./coordVerification");

describe("coordVerification", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchVerificationMetrics GETs the window, encoded", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ degraded: false }))
    );
    await expect(fetchVerificationMetrics("28d")).resolves.toEqual({
      degraded: false,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/verification/metrics?window=28d",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchVerificationMetrics keeps a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"detail":"coord is not reachable"}', { status: 502 })
    );
    await expect(fetchVerificationMetrics("7d")).rejects.toThrow(
      'GET /api/v1/operations/coord/verification/metrics?window=7d failed: 502 - {"detail":"coord is not reachable"}'
    );
  });
});
