import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchRecentLands, fetchLandPrecision, fetchLandPreview } =
  await import("./landsReads");

describe("landsReads", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchRecentLands GETs /lands with no retries", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ lands: [] }))
    );
    await expect(
      fetchRecentLands(new URLSearchParams({ limit: "25" }))
    ).resolves.toEqual({ lands: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands?limit=25",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchLandPrecision GETs /lands/precision with no retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ a: 1 })));
    await fetchLandPrecision();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands/precision",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchLandPreview GETs /lands/preview with default retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ a: 1 })));
    await fetchLandPreview(new URLSearchParams({ repo: "o/r", pr: "1" }));
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands/preview?repo=o%2Fr&pr=1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 404 }));
    const err = await fetchLandPreview(new URLSearchParams()).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(404);
  });
});
