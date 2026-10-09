import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordAlerts` function's exact request: the RELATIVE URL written
 * out as a LITERAL, the encoded query, and the `httpClient.fetch` options.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchAlerts, fetchFaultToVisibility } = await import("./coordAlerts");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordAlerts", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchAlerts GETs /alerts with the resolved flag and the encoded kind", async () => {
    fetchMock.mockResolvedValueOnce(json({ alerts: [] }));
    await expect(
      fetchAlerts(
        { includeResolved: false, kind: "red main" },
        { maxRetries: 0 }
      )
    ).resolves.toEqual({ alerts: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/alerts?include_resolved=false&kind=red%20main",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchFaultToVisibility GETs /alerts/fault-to-visibility, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({ p50: 1 }));
    await expect(fetchFaultToVisibility()).resolves.toEqual({ p50: 1 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/alerts/fault-to-visibility",
      { method: "GET", idempotent: true },
    ]);
  });

  it("rejects a non-2xx in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 503));
    const err = await fetchFaultToVisibility().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/alerts/fault-to-visibility failed: 503 - {"error":"x"}'
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});
