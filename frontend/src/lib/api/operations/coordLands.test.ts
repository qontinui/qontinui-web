import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordLands` function's exact request: the RELATIVE URL written
 * out as a LITERAL, the `encodeURIComponent` of every path parameter, the
 * query's key order and which keys are omitted, and the `httpClient.fetch`
 * options the route walker cannot see (method, stated retry policy, the
 * caller options spread under them). Bodies are compared as strings.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  createPolicyClause,
  fetchCoordFindingById,
  fetchCoordFindings,
  fetchCoordPlans,
  fetchDeployList,
  fetchDeployRollbackProposal,
  fetchFederationReports,
  fetchGitOpsBranches,
  fetchGitOpsList,
  fetchLandList,
  fetchLandPrecision,
  fetchLandPreview,
  fetchLandVerifications,
  fetchNotifications,
  markNotificationsRead,
  respondToAgentQuestion,
} = await import("./coordLands");

const OPTS = { noRetryStatuses: [503] };

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function get(url: string, extra: object = {}): [string, object] {
  return [url, { ...extra, method: "GET", idempotent: true }];
}

describe("coordLands", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "x" }, 502));
    const err = await fetchLandPrecision().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/lands/precision failed: 502 - {"detail":"x"}'
    );
    expect(httpStatusOf(err)).toBe(502);
  });

  it("fetchFederationReports omits an absent since", async () => {
    fetchMock.mockImplementation(async () => answer({ reports: [] }));
    await fetchFederationReports({ limit: 200 });
    await fetchFederationReports(
      { since: "2026-10-01T00:00:00.000Z", limit: 200 },
      OPTS
    );
    expect(fetchMock.mock.calls).toEqual([
      get("/api/v1/operations/federation/reports?limit=200"),
      get(
        "/api/v1/operations/federation/reports?since=2026-10-01T00%3A00%3A00.000Z&limit=200",
        OPTS
      ),
    ]);
  });

  it("fetchCoordFindings GETs the caller query string", async () => {
    fetchMock.mockResolvedValueOnce(answer({ findings: [] }));
    await fetchCoordFindings("limit=50&topic=t");
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/coord/findings?limit=50&topic=t")
    );
  });

  it("fetchCoordFindingById encodes the id", async () => {
    fetchMock.mockResolvedValueOnce(answer({ findings: [] }));
    await fetchCoordFindingById("a b/c");
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/coord/findings?finding_id=a%20b%2Fc")
    );
  });

  it("fetchCoordPlans sends status then limit", async () => {
    fetchMock.mockResolvedValueOnce(answer({ plans: [] }));
    await fetchCoordPlans({ status: "shipped", limit: 50 }, OPTS);
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/plans?status=shipped&limit=50", OPTS)
    );
  });

  it("fetchLandPrecision GETs /lands/precision with the caller options", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fetchLandPrecision(OPTS);
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/lands/precision", OPTS)
    );
  });

  it("fetchLandPreview sends repo then pr, encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fetchLandPreview({ repo: "qontinui/qontinui-web", pr: "12" });
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/lands/preview?repo=qontinui%2Fqontinui-web&pr=12")
    );
  });

  it("fetchLandList omits an empty repo", async () => {
    fetchMock.mockImplementation(async () => answer({ lands: [] }));
    await fetchLandList({ repo: "", limit: 25 }, OPTS);
    await fetchLandList({ repo: "a/b", limit: 25 });
    expect(fetchMock.mock.calls).toEqual([
      get("/api/v1/operations/lands?limit=25", OPTS),
      get("/api/v1/operations/lands?repo=a%2Fb&limit=25"),
    ]);
  });

  it("fetchLandVerifications encodes the correlation id", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fetchLandVerifications("c/1 2");
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/lands/verifications?correlation_id=c%2F1+2")
    );
  });

  it("fetchDeployList omits an empty service", async () => {
    fetchMock.mockImplementation(async () => answer({ deploys: [] }));
    await fetchDeployList({ service: "", limit: 25 }, OPTS);
    await fetchDeployList({ service: "coord", limit: 25 });
    expect(fetchMock.mock.calls).toEqual([
      get("/api/v1/operations/deploys?limit=25", OPTS),
      get("/api/v1/operations/deploys?service=coord&limit=25"),
    ]);
  });

  it("fetchDeployRollbackProposal GETs the deploy rollback-proposal", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fetchDeployRollbackProposal("ab12");
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/deploys/ab12/rollback-proposal")
    );
  });

  it("fetchGitOpsList sends since, repo, limit in that order, omitting absent ones", async () => {
    fetchMock.mockImplementation(async () => answer({ ops: [] }));
    await fetchGitOpsList({ since: "s", repo: "a/b", limit: 200 }, OPTS);
    await fetchGitOpsList({ repo: "", limit: 200 });
    expect(fetchMock.mock.calls).toEqual([
      get("/api/v1/operations/git-ops/list?since=s&repo=a%2Fb&limit=200", OPTS),
      get("/api/v1/operations/git-ops/list?limit=200"),
    ]);
  });

  it("fetchGitOpsBranches GETs /git-ops/branches", async () => {
    fetchMock.mockResolvedValueOnce(answer({ branches: [] }));
    await fetchGitOpsBranches(OPTS);
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/git-ops/branches", OPTS)
    );
  });

  it("fetchNotifications GETs the caller query string with its options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ notifications: [] }));
    await fetchNotifications("limit=1", OPTS);
    expect(fetchMock.mock.calls[0]).toEqual(
      get("/api/v1/operations/notifications?limit=1", OPTS)
    );
  });

  it("markNotificationsRead POSTs the selection as the body, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ marked: 1 }));
    await expect(
      markNotificationsRead({ notification_ids: ["n1"] }, OPTS)
    ).resolves.toEqual({ marked: 1 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications/mark-read",
      {
        ...OPTS,
        method: "POST",
        body: '{"notification_ids":["n1"]}',
        idempotent: false,
      },
    ]);
  });

  it("respondToAgentQuestion POSTs to the encoded question respond route", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await respondToAgentQuestion("q/1 2", {
      responded_by_operator: "op",
      response: "note",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/q%2F1%202/respond",
      {
        method: "POST",
        body: '{"response":"note","responded_by_operator":"op"}',
        idempotent: false,
      },
    ]);
  });

  it("createPolicyClause POSTs the clause to the encoded category clauses route", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await createPolicyClause("git ops/x", { status: "proposed" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/prompt-documents/policy/git%20ops%2Fx/clauses",
      {
        method: "POST",
        body: '{"status":"proposed"}',
        idempotent: false,
      },
    ]);
  });
});
