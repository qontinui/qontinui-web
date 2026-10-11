import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `prMergeBoard` function's exact request: the RELATIVE URL as a
 * LITERAL, the method, the body and the retry policy the route walker cannot
 * see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const board = await import("./prMergeBoard");

const POLL = { method: "GET", maxRetries: 0 };

describe("prMergeBoard", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("the poll reads GET their routes with no client retries", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await board.fetchMergeQueue();
    await board.fetchPrMergePrsWithMergedCount(48);
    await board.fetchPrMergePrsIncludingMerged(48);
    await board.fetchPrMergePrList();
    await board.fetchPrMergeSuggestions();
    await board.fetchBlastRadiusBlocks();
    await board.fetchStuckNudges("acme/web");
    await board.fetchPrMergeVerdict("ac me", "web", 7);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/merge/queue", POLL],
      ["/api/v1/operations/pr-merge/prs?merged_count_hours=48", POLL],
      ["/api/v1/operations/pr-merge/prs?include_merged=48", POLL],
      ["/api/v1/operations/pr-merge/prs", POLL],
      ["/api/v1/operations/pr-merge/suggestions", POLL],
      ["/api/v1/operations/pr-merge/blast-radius-blocks", POLL],
      ["/api/v1/operations/pr-merge/acme/web/stuck-nudges", POLL],
      ["/api/v1/operations/pr-merge/verdict/ac%20me/web/7", POLL],
    ]);
  });

  it("the one-shot reads keep the default retry budget", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await board.fetchPrMergeHealth();
    await board.fetchPrChecks("acme/web", 7);
    await board.fetchPrMergeGraph("repo=acme%2Fweb&pr=7");
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/pr-merge/health"],
      ["/api/v1/operations/pr-merge/prs/acme%2Fweb/7/checks"],
      ["/api/v1/operations/pr-merge/graph?repo=acme%2Fweb&pr=7"],
    ]);
  });

  it("the actions POST their JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await board.postSuggestionAction(12, "mute", { hours: 2 });
    await board.postProposalCancel("p/1", { unblock: true, reason: "r" });
    await board.postPrReevaluate("acme", "web", 7);
    await board.postPrDraftState("acme", "web", 7, true);
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/pr-merge/suggestions/12/mute",
        { method: "POST", body: JSON.stringify({ hours: 2 }) },
      ],
      [
        "/api/v1/operations/pr-merge/proposals/p%2F1/cancel",
        {
          method: "POST",
          body: JSON.stringify({ unblock: true, reason: "r" }),
        },
      ],
      [
        "/api/v1/operations/pr-merge/prs/acme/web/7/reevaluate",
        { method: "POST", body: "{}" },
      ],
      [
        "/api/v1/operations/prs/acme/web/7/draft-state",
        { method: "POST", body: JSON.stringify({ draft: true }) },
      ],
    ]);
  });
});
