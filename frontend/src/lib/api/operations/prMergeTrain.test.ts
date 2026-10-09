import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prMergeTrain` function's exact request: the RELATIVE URL written
 * out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the `encodeURIComponent` of every path parameter, and
 * the `httpClient.fetch` options the route walker cannot see — the method, the
 * stated retry policy, and the caller's options passed through. `toEqual` on
 * the whole options object keeps them that way unless a change says so.
 * Bodies are compared as strings, so the wire key order is pinned too.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  actOnMergeSuggestion,
  cancelMergeProposal,
  engageKillSwitch,
  fetchBlastRadiusBlocks,
  fetchCiOverview,
  fetchMergeEconomics,
  fetchMergeQueue,
  fetchMergeSuggestions,
  fetchPrChecks,
  fetchPrMergeGraph,
  fetchPrMergePrs,
  fetchPrMergePrsIncludingMerged,
  fetchPrMergePrsWithMergedCount,
  fetchPrMergeVerdict,
  fetchPullDecisions,
  fetchStuckNudges,
  fetchTrainHealth,
  httpStatusLabel,
  reevaluatePr,
} = await import("./prMergeTrain");

const POLL = { maxRetries: 0 };
/** A repo / owner / name that only survives as one path segment if encoded. */
const REPO = "acme/web app#1";
const REPO_ENCODED = "acme%2Fweb%20app%231";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function lastCall(): [string, Record<string, unknown>] {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0] as [string, Record<string, unknown>];
}

describe("prMergeTrain", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in httpClient.get's error shape, naming the method", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "nope" }, 404));
    const err = await fetchTrainHealth().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/pr-merge/health failed: 404 - {"detail":"nope"}'
    );
    expect(httpStatusOf(err)).toBe(404);
    expect(httpBodyOf(err)).toBe('{"detail":"nope"}');
    expect(httpStatusLabel(err)).toBe("HTTP 404");
    expect(httpStatusLabel(new TypeError("Failed to fetch"))).toBe(
      "Failed to fetch"
    );
  });

  it("fetchMergeQueue GETs /merge/queue, declared idempotent, passing the caller's options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ proposals: [] }));
    await expect(fetchMergeQueue(POLL)).resolves.toEqual({ proposals: [] });
    expect(lastCall()).toEqual([
      "/api/v1/operations/merge/queue",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPrMergePrs GETs /pr-merge/prs, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(answer({ prs: [] }));
    await expect(fetchPrMergePrs(POLL)).resolves.toEqual({ prs: [] });
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/prs",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPrMergePrsWithMergedCount GETs /pr-merge/prs?merged_count_hours=", async () => {
    fetchMock.mockResolvedValueOnce(answer({ prs: [] }));
    await fetchPrMergePrsWithMergedCount(48, POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/prs?merged_count_hours=48",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPrMergePrsIncludingMerged GETs /pr-merge/prs?include_merged=", async () => {
    fetchMock.mockResolvedValueOnce(answer({ prs: [] }));
    await fetchPrMergePrsIncludingMerged(48, { maxRetries: 0 });
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/prs?include_merged=48",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchMergeEconomics GETs /pr-merge/merge-economics", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repos: [] }));
    await expect(fetchMergeEconomics(POLL)).resolves.toEqual({ repos: [] });
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/merge-economics",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchMergeSuggestions GETs /pr-merge/suggestions", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await fetchMergeSuggestions(POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/suggestions",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchBlastRadiusBlocks GETs /pr-merge/blast-radius-blocks", async () => {
    fetchMock.mockResolvedValueOnce(answer({ blocks: [] }));
    await fetchBlastRadiusBlocks(POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/blast-radius-blocks",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchTrainHealth GETs /pr-merge/health with no options of its own", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await expect(fetchTrainHealth()).resolves.toEqual({});
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/health",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchPrMergeGraph GETs /pr-merge/graph with the repo query-encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ nodes: [] }));
    await fetchPrMergeGraph(REPO, 7);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/graph?repo=acme%2Fweb+app%231&pr=7",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchPrChecks GETs /pr-merge/prs/{repo}/{pr}/checks with the repo as one encoded segment", async () => {
    fetchMock.mockResolvedValueOnce(answer({ checks: [] }));
    await fetchPrChecks(REPO, 7);
    expect(lastCall()).toEqual([
      `/api/v1/operations/pr-merge/prs/${REPO_ENCODED}/7/checks`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchStuckNudges GETs /pr-merge/{repo}/stuck-nudges with the repo inlined", async () => {
    fetchMock.mockResolvedValueOnce(answer({ enabled: true }));
    await fetchStuckNudges("acme/web", POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/acme/web/stuck-nudges",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPrMergeVerdict GETs /pr-merge/verdict/{owner}/{name}/{pr}, encoding owner and name", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fetchPrMergeVerdict("a/b c", "n#1", 7, POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/verdict/a%2Fb%20c/n%231/7",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchCiOverview GETs /ci/overview", async () => {
    fetchMock.mockResolvedValueOnce(answer({ pools: [], repos: [] }));
    await fetchCiOverview(POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/ci/overview",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPullDecisions GETs /coord/pull-decisions, leaving empty filters off the query", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await fetchPullDecisions({ deviceId: "", repo: "" }, POLL);
    expect(lastCall()).toEqual([
      "/api/v1/operations/coord/pull-decisions",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPullDecisions query-encodes device_id and repo, in that order", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await fetchPullDecisions({ deviceId: "d-1", repo: REPO }, POLL);
    expect(lastCall()[0]).toBe(
      "/api/v1/operations/coord/pull-decisions?device_id=d-1&repo=acme%2Fweb+app%231"
    );
  });

  it("engageKillSwitch POSTs /pr-merge/kill-switch, not re-sent on a 5xx", async () => {
    const data = {
      scope: "tenant",
      previous_merge_enabled: true,
      merge_enabled: false,
      affected_repos: [],
    };
    fetchMock.mockResolvedValueOnce(answer(data));
    await expect(engageKillSwitch("tenant", "why")).resolves.toEqual(data);
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/kill-switch",
      {
        method: "POST",
        body: '{"scope":"tenant","reason":"why"}',
        idempotent: false,
      },
    ]);
  });

  it("actOnMergeSuggestion POSTs /pr-merge/suggestions/{id}/{action}, defaulting the body to {}", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(actOnMergeSuggestion(12, "mute")).resolves.toBeNull();
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/suggestions/12/mute",
      { method: "POST", body: "{}", idempotent: false },
    ]);
  });

  it("reevaluatePr POSTs /pr-merge/prs/{owner}/{name}/{pr}/reevaluate, encoding owner and name", async () => {
    fetchMock.mockResolvedValueOnce(answer({ evaluated: true }));
    await expect(reevaluatePr("a/b c", "n#1", 7)).resolves.toEqual({
      evaluated: true,
    });
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/prs/a%2Fb%20c/n%231/7/reevaluate",
      { method: "POST", body: "{}", idempotent: false },
    ]);
  });

  it("cancelMergeProposal POSTs /pr-merge/proposals/{id}/cancel with unblock before reason", async () => {
    fetchMock.mockResolvedValueOnce(answer({ status: "cancelled" }));
    await cancelMergeProposal("p/1 #", { unblock: true, reason: "r" });
    expect(lastCall()).toEqual([
      "/api/v1/operations/pr-merge/proposals/p%2F1%20%23/cancel",
      {
        method: "POST",
        body: '{"unblock":true,"reason":"r"}',
        idempotent: false,
      },
    ]);
  });
});
