import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins the two `coordAudit` reads' exact requests: the RELATIVE URL on
 * `httpClient.fetch`, the query each one builds, and the init.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchCoordAuditRecent, fetchFaultToVisibility } =
  await import("./coordAudit");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordAudit", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchCoordAuditRecent GETs /coord/audit/recent with every filter set", async () => {
    fetchMock.mockResolvedValueOnce(json({ audit: [], count: 0 }));
    await expect(
      fetchCoordAuditRecent({
        limit: 100,
        action: "fleet.*",
        via: "mcp",
        resource_key: "k 1",
      })
    ).resolves.toEqual({ audit: [], count: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/audit/recent?limit=100&action=fleet.*&via=mcp&resource_key=k+1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchCoordAuditRecent omits empty and absent filters", async () => {
    fetchMock.mockResolvedValueOnce(json({ audit: [] }));
    await fetchCoordAuditRecent({
      limit: 100,
      action: null,
      via: undefined,
      resource_key: "",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/audit/recent?limit=100",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchCoordAuditRecent rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const err = await fetchCoordAuditRecent({ limit: 100 }).catch(
      (e: unknown) => e
    );
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/coord/audit/recent?limit=100 failed: 403 - nope"
    );
    expect(httpStatusOf(err)).toBe(403);
  });

  it("fetchFaultToVisibility GETs /alerts/fault-to-visibility with the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(json({ kinds: [] }));
    await expect(fetchFaultToVisibility({ maxRetries: 0 })).resolves.toEqual({
      kinds: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/alerts/fault-to-visibility",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });
});
