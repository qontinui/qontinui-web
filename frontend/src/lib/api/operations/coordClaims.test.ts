import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordClaims` function's exact request: the RELATIVE URL as a
 * LITERAL, the `encodeURIComponent` of the gate id, and the `httpClient.fetch`
 * options (method, idempotent, the caller's retry budget).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  approveGate,
  fetchActiveClaims,
  fetchAgentStatus,
  fetchClaimSteals,
  fetchGatesList,
  fetchRecentConflicts,
  rejectGate,
} = await import("./coordClaims");

const RAW = "g/1 #2";
const ENCODED = "g%2F1%20%232";
const POLL = { maxRetries: 0 };

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordClaims", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "bad" }, 502));
    const err = await fetchGatesList().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/gates/list failed: 502 - {"detail":"bad"}'
    );
    expect(httpStatusOf(err)).toBe(502);
    expect(httpBodyOf(err)).toBe('{"detail":"bad"}');
  });

  it("fetchAgentStatus GETs /agent-status", async () => {
    fetchMock.mockResolvedValueOnce(answer({ agents: [], count: 0 }));
    await fetchAgentStatus(POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-status",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchActiveClaims GETs /claims/list with the query", async () => {
    fetchMock.mockResolvedValueOnce(answer({ holders: [] }));
    await fetchActiveClaims(
      new URLSearchParams({ kind: "file_glob", prefix: "a/b" }),
      POLL
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claims/list?kind=file_glob&prefix=a%2Fb",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchRecentConflicts GETs /claims/recent-conflicts with the limit", async () => {
    fetchMock.mockResolvedValueOnce(answer({ entries: [] }));
    await fetchRecentConflicts(50, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claims/recent-conflicts?limit=50",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchClaimSteals GETs /claims/steals with the limit", async () => {
    fetchMock.mockResolvedValueOnce(answer({ rows: [] }));
    await fetchClaimSteals(50, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claims/steals?limit=50",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchGatesList GETs /gates/list", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await expect(fetchGatesList(POLL)).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/gates/list",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("approveGate POSTs /gates/{id}/approve with the id encoded, not idempotent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(approveGate(RAW, POLL)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/gates/${ENCODED}/approve`,
      { maxRetries: 0, method: "POST", idempotent: false },
    ]);
  });

  it("rejectGate POSTs /gates/{id}/reject with the id encoded, not idempotent", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await rejectGate(RAW);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/gates/${ENCODED}/reject`,
      { method: "POST", idempotent: false },
    ]);
  });
});
