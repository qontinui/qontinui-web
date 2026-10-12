import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins `fetchMergeEconomics`'s exact request. Kept out of `prMerge.test.ts`
 * so the batch that owns the rest of the pipeline reads can edit that file
 * without a conflict here.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchMergeEconomics } = await import("./prMerge");

describe("prMerge economics", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchMergeEconomics GETs /pr-merge/merge-economics with no client retries and resolves the body", async () => {
    const body = { repos: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchMergeEconomics()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/merge-economics",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchMergeEconomics rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 503 }));
    const err = await fetchMergeEconomics().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(503);
  });
});
