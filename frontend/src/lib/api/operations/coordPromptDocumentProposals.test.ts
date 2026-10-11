import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request of each `coordPromptDocumentProposals` function. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  decidePolicyProposal,
  fetchPolicyProposals,
  fetchPolicyProposalsPage,
  fetchPromptDocumentWrites,
} = await import("./coordPromptDocumentProposals");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const GET = { method: "GET", idempotent: true };

describe("coordPromptDocumentProposals", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchPolicyProposals sends the status, and the limit on the paged read", async () => {
    fetchMock.mockImplementation(async () => answer({ proposals: [] }));
    await fetchPolicyProposals("pending");
    await fetchPolicyProposalsPage("approved", 20);
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/coord/prompt-document-proposals?status=pending",
        GET,
      ],
      [
        "/api/v1/operations/coord/prompt-document-proposals?status=approved&limit=20",
        GET,
      ],
    ]);
  });

  it("decidePolicyProposal POSTs the note only when given and is never re-sent", async () => {
    fetchMock.mockImplementation(async () => answer({}));
    await decidePolicyProposal("p/1", "approve", "ok");
    await decidePolicyProposal("p1", "reject");
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/coord/prompt-document-proposals/p%2F1/approve",
        { method: "POST", body: '{"decision_note":"ok"}', idempotent: false },
      ],
      [
        "/api/v1/operations/coord/prompt-document-proposals/p1/reject",
        { method: "POST", body: "{}", idempotent: false },
      ],
    ]);
  });

  it("fetchPromptDocumentWrites GETs the feed with its limit", async () => {
    fetchMock.mockResolvedValueOnce(answer({ writes: [] }));
    await expect(fetchPromptDocumentWrites(40)).resolves.toEqual({
      writes: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/prompt-document-writes?limit=40",
      GET,
    ]);
  });

  it("rejects a non-2xx in httpClient's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    const err = await fetchPolicyProposals("weird").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/coord/prompt-document-proposals?status=weird failed: 400 - bad"
    );
  });
});
