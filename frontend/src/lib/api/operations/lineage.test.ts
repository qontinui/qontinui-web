import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `lineage` function's exact request: the RELATIVE URL written out as a
 * LITERAL (so a change to the shared base cannot move every expectation with
 * it), the method, the body, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => fetchMock.mockReset());

const m = await import("./lineage");

describe("lineage", () => {
  it("fetchRecentLineage GETs /lineage/recent and forwards the signal", async () => {
    fetchMock.mockResolvedValueOnce(answer({ rows: [] }));
    const controller = new AbortController();
    await expect(m.fetchRecentLineage(25, controller.signal)).resolves.toEqual({
      rows: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lineage/recent?limit=25",
      { signal: controller.signal },
    ]);
  });

  it("fetchLineageStats and fetchSessionLineageCommits use the lineage paths", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer({})));
    await m.fetchLineageStats();
    await m.fetchSessionLineageCommits("a/b");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/operations/lineage/stats",
      "/api/v1/operations/lineage/sessions/a%2Fb/commits",
    ]);
  });

  it("a non-2xx rejects with the status and body readable", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ error: "schema_migration_pending" }, 503)
    );
    const err = await m.fetchLineageStats().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(503);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/lineage/stats failed: 503 - {"error":"schema_migration_pending"}'
    );
  });
});
