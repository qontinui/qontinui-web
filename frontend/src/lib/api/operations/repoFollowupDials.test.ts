import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each per-repo follow-up dial function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchPostMergeFollowupScope,
  putPostMergeFollowupScope,
  fetchContinuationDeliveryMode,
  putContinuationDeliveryMode,
} = await import("./repoFollowupDials");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("repoFollowupDials", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchPostMergeFollowupScope GETs with the repo encoded and parses", async () => {
    const body = { repo: "o/r", scope: "all" };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchPostMergeFollowupScope("o/r")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/post-merge-followup-scope?repo=o%2Fr",
      { method: "GET", idempotent: true },
    ]);
  });

  it("putPostMergeFollowupScope PUTs the body, declared non-idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, effective: null }));
    await putPostMergeFollowupScope({
      repo: "o/r",
      scope: "code_only",
      code_paths: ["src/**"],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/post-merge-followup-scope",
      {
        method: "PUT",
        body: '{"repo":"o/r","scope":"code_only","code_paths":["src/**"]}',
        idempotent: false,
      },
    ]);
  });

  it("fetchContinuationDeliveryMode GETs with the repo encoded", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ repo: "o/r", mode: "spawn_always" })
    );
    await fetchContinuationDeliveryMode("o/r");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/continuation-delivery-mode?repo=o%2Fr",
      { method: "GET", idempotent: true },
    ]);
  });

  it("putContinuationDeliveryMode PUTs {repo, mode}", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, effective: null }));
    await putContinuationDeliveryMode("o/r", "notify_only");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/continuation-delivery-mode",
      {
        method: "PUT",
        body: '{"repo":"o/r","mode":"notify_only"}',
        idempotent: false,
      },
    ]);
  });

  it("a non-2xx rejects with the httpClient.get shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("unreadable", { status: 503 })
    );
    await expect(fetchPostMergeFollowupScope("o/r")).rejects.toThrow(
      "GET /api/v1/operations/post-merge-followup-scope?repo=o%2Fr failed: 503 - unreadable"
    );
  });
});
