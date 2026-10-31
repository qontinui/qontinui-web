import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each Phase 7 batch 7 `prMerge` function's exact request — the merge
 * pipeline, train, recovery and hold routes: the RELATIVE URL written
 * out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the method, the body's exact bytes, and the retry
 * policy the route walker cannot see. `toEqual` on the whole init keeps them
 * that way unless a change says so.
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
  fetchBlastRadiusBlocks,
  fetchMergeQueue,
  fetchMergeSuggestions,
  fetchOpenPrs,
  fetchOpenPrsWithMergedCount,
  fetchPrChecks,
  fetchPrGraph,
  fetchPrMergeVerdict,
  fetchPrsIncludingMerged,
  fetchStuckNudges,
  fetchTrainHealth,
  patchTenantAutoFixPr,
  reevaluatePr,
  setPrHold,
} = await import("./prMerge");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const POLL = { method: "GET", idempotent: true, maxRetries: 0 };
const GET = { method: "GET", idempotent: true };

describe("prMerge pipeline + recovery client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("patchTenantAutoFixPr PATCHes ONLY auto_fix_pr, never re-sent on a 5xx, and parses the echo", async () => {
    const body = { tenant_id: "t-1", profile: { auto_fix_pr: null } };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(patchTenantAutoFixPr(null)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      { method: "PATCH", body: '{"auto_fix_pr":null}', idempotent: false },
    ]);
  });

  it("patchTenantAutoFixPr keeps httpClient.patch's error shape, which isUnconfirmedFailure reads", async () => {
    fetchMock.mockResolvedValueOnce(new Response("gateway", { status: 504 }));
    const err = await patchTenantAutoFixPr(true).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "PATCH /api/v1/operations/pr-merge/settings failed: 504 - gateway"
    );
  });

  it("fetchMergeQueue GETs /merge/queue as a no-retry poll", async () => {
    const body = { proposals: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMergeQueue()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/merge/queue",
      POLL,
    ]);
  });

  it("fetchOpenPrsWithMergedCount carries merged_count_hours", async () => {
    const body = { prs: [], merged_recent_count: 3 };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchOpenPrsWithMergedCount(48)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/prs?merged_count_hours=48",
      POLL,
    ]);
  });

  it("fetchPrsIncludingMerged carries include_merged, with no client retry", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await expect(fetchPrsIncludingMerged(48)).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/prs?include_merged=48",
      POLL,
    ]);
  });

  it("fetchOpenPrs GETs the bare /pr-merge/prs listing", async () => {
    const body = { prs: [{ repo: "o/r", pr_number: 1 }] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchOpenPrs()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/prs",
      POLL,
    ]);
  });

  it("fetchMergeSuggestions GETs /pr-merge/suggestions", async () => {
    const body = { suggestions: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMergeSuggestions()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/suggestions",
      POLL,
    ]);
  });

  it("actOnMergeSuggestion POSTs the action, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(actOnMergeSuggestion(7, "mute", { hours: 2 })).resolves.toBe(
      null
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/suggestions/7/mute",
      { method: "POST", body: '{"hours":2}', idempotent: false },
    ]);
  });

  it("fetchBlastRadiusBlocks GETs /pr-merge/blast-radius-blocks, and a 404 rejects with its status", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "nope" }, 404));
    const err = await fetchBlastRadiusBlocks().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(404);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/blast-radius-blocks",
      POLL,
    ]);
  });

  it("fetchTrainHealth GETs /pr-merge/health", async () => {
    const body = { fleet: { ok: true } };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTrainHealth()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/health",
      GET,
    ]);
  });

  it("fetchPrChecks percent-encodes the repo, as it always has", async () => {
    const body = { checks: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchPrChecks("owner/name", 12)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/prs/owner%2Fname/12/checks",
      GET,
    ]);
  });

  it("fetchPrGraph builds its query with URLSearchParams", async () => {
    const body = {
      nodes: [],
      edges: [],
      topo_order: [],
      cycle_detected: false,
      cycle_members: [],
    };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchPrGraph("owner/name", 5)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/graph?repo=owner%2Fname&pr=5",
      GET,
    ]);
  });

  it("fetchStuckNudges inlines owner/name UNENCODED (the route's :path converter)", async () => {
    const body = { repo: "owner/name", enabled: true, stuck_now: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchStuckNudges("owner/name")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/owner/name/stuck-nudges",
      POLL,
    ]);
  });

  it("fetchPrMergeVerdict encodes owner and name separately", async () => {
    const body = { proposal: null };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchPrMergeVerdict("a b", "c#d", 9)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/verdict/a%20b/c%23d/9",
      POLL,
    ]);
  });

  it("cancelMergeProposal POSTs {unblock, reason} to the encoded proposal, never re-sent on a 5xx", async () => {
    const body = { cancelled: true };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(
      cancelMergeProposal("p/1", { unblock: true, reason: "operator" })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/proposals/p%2F1/cancel",
      {
        method: "POST",
        body: '{"unblock":true,"reason":"operator"}',
        idempotent: false,
      },
    ]);
  });

  it("cancelMergeProposal hands coord's 409 body back through the rejection", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "land_in_flight" }, 409));
    const err = await cancelMergeProposal("p1", {
      unblock: false,
      reason: "r",
    }).catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(409);
    expect(httpBodyOf(err)).toBe('{"error":"land_in_flight"}');
  });

  it("reevaluatePr POSTs {} to the encoded PR, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ evaluated: true }));
    await expect(reevaluatePr("own er", "na/me", 3)).resolves.toEqual({
      evaluated: true,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/prs/own%20er/na%2Fme/3/reevaluate",
      { method: "POST", body: "{}", idempotent: false },
    ]);
  });

  it("setPrHold POSTs {held, reason} to /prs/.../hold, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(
      setPrHold("o", "r", 4, true, "waiting on web#1")
    ).resolves.toBe(null);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/prs/o/r/4/hold",
      {
        method: "POST",
        body: '{"held":true,"reason":"waiting on web#1"}',
        idempotent: false,
      },
    ]);
  });

  it("setPrHold omits reason on a release", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await setPrHold("o", "r", 4, false, null);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: "POST",
      body: '{"held":false}',
      idempotent: false,
    });
  });
});
