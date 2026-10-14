import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins every `claims.ts` request: the RELATIVE URL (plan D6, literal here),
 * `httpClient.fetch` (these replaced a bare `fetch` that sent no bearer), the
 * caller's options kept, and the read declared `idempotent`.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  CLAIMS_ROUTES_LABEL,
  fetchActiveClaims,
  fetchAgentStatus,
  fetchClaimSteals,
  fetchRecentConflicts,
} = await import("./claims");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("claims client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchAgentStatus GETs /agent-status, keeping the caller's retry budget", async () => {
    const body = { agents: [], count: 0 };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchAgentStatus({ maxRetries: 0 })).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-status",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchActiveClaims GETs /claims/list with kind, and prefix only when set", async () => {
    fetchMock.mockResolvedValueOnce(json({ holders: [] }));
    await fetchActiveClaims("file_glob", "");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claims/list?kind=file_glob",
      { method: "GET", idempotent: true },
    ]);

    fetchMock.mockResolvedValueOnce(json({ holders: [] }));
    await fetchActiveClaims("phase", "plan a/b");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/operations/claims/list?kind=phase&prefix=plan+a%2Fb"
    );
  });

  it("fetchRecentConflicts GETs /claims/recent-conflicts?limit=", async () => {
    fetchMock.mockResolvedValueOnce(json({ entries: [] }));
    await fetchRecentConflicts(50);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claims/recent-conflicts?limit=50",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchClaimSteals GETs /claims/steals?limit=", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [] }));
    await fetchClaimSteals(50);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claims/steals?limit=50",
      { method: "GET", idempotent: true },
    ]);
  });

  it("a non-2xx read rejects in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("coord down", { status: 502 }));
    const err = await fetchClaimSteals(50).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/claims/steals?limit=50 failed: 502 - coord down"
    );
    expect(httpStatusOf(err)).toBe(502);
    expect(httpBodyOf(err)).toBe("coord down");
  });

  it("names the claims route family for display", () => {
    expect(CLAIMS_ROUTES_LABEL).toBe("/api/v1/operations/claims/*");
  });
});
