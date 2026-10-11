import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins each `repoFollowupDials` function's exact request. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const {
  fetchContinuationDeliveryMode,
  fetchPostMergeFollowupScope,
  putContinuationDeliveryMode,
  putPostMergeFollowupScope,
} = await import("./repoFollowupDials");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("repoFollowupDials", () => {
  afterEach(() => fetchMock.mockReset());

  it("reads GET the encoded ?repo= of each dial", async () => {
    fetchMock.mockImplementation(async () => answer({}));
    await fetchPostMergeFollowupScope("o/r");
    await fetchContinuationDeliveryMode("o/r");
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/post-merge-followup-scope?repo=o%2Fr",
        { method: "GET" },
      ],
      [
        "/api/v1/operations/continuation-delivery-mode?repo=o%2Fr",
        { method: "GET" },
      ],
    ]);
  });

  it("writes PUT their JSON body", async () => {
    fetchMock.mockImplementation(async () => answer({ ok: true }));
    await putPostMergeFollowupScope({ repo: "o/r", scope: "none" });
    await putContinuationDeliveryMode({ repo: "o/r", mode: "shadow" });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/post-merge-followup-scope",
        { method: "PUT", body: '{"repo":"o/r","scope":"none"}' },
      ],
      [
        "/api/v1/operations/continuation-delivery-mode",
        { method: "PUT", body: '{"repo":"o/r","mode":"shadow"}' },
      ],
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "admin_required" }, 403));
    const err = await putPostMergeFollowupScope({
      repo: "o/r",
      scope: "all",
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'PUT /api/v1/operations/post-merge-followup-scope failed: 403 - {"error":"admin_required"}'
    );
    expect(httpStatusOf(err)).toBe(403);
  });
});
