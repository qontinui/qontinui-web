import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordConsole` function's exact request: the RELATIVE URL written out as a
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

const m = await import("./coordConsole");

describe("coordConsole", () => {
  it("fetchNotificationsUnread GETs /notifications?limit=1 with the caller options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ unread_count: 3 }));
    await expect(
      m.fetchNotificationsUnread({ noRetryStatuses: [503] })
    ).resolves.toEqual({ unread_count: 3 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications?limit=1",
      { noRetryStatuses: [503], method: "GET", idempotent: true },
    ]);
  });

  it("fetchRollbackProposal GETs the deploy proposal and rejects in the helpers error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "no" }, 404));
    const err = await m.fetchRollbackProposal("abc").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/deploys/abc/rollback-proposal failed: 404 - {"error":"no"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });

  it("respondToAgentQuestion POSTs the encoded question id", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await m.respondToAgentQuestion("q/1", {
      response: "r",
      responded_by_operator: "op",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/q%2F1/respond",
      {
        method: "POST",
        body: '{"response":"r","responded_by_operator":"op"}',
      },
    ]);
  });

  it("createPolicyClause POSTs the clause under the encoded category", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await m.createPolicyClause("git ops", { clause_id: "c" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/prompt-documents/policy/git%20ops/clauses",
      { method: "POST", body: '{"clause_id":"c"}' },
    ]);
  });

  it("fetchLandVerifications GETs by correlation id", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repos: [] }));
    await expect(m.fetchLandVerifications("c 1")).resolves.toEqual({
      repos: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands/verifications?correlation_id=c+1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchOpenAlertsByKind GETs open alerts of a kind with the poll options", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await expect(
      m.fetchOpenAlertsByKind("red_main", { maxRetries: 0 })
    ).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/alerts?include_resolved=false&kind=red_main",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });
});
