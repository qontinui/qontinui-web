import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request `fetchReleaseHistory` sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchReleaseHistory } = await import("./releases");

describe("releases", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchReleaseHistory GETs /releases with repo and limit and the caller's retry budget", async () => {
    const body = { surface: "s", repo: "a/b", target: "t", count: 0, history: [] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(
      fetchReleaseHistory({ repo: "a/b", limit: 100 }, { maxRetries: 0 })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/releases?repo=a%2Fb&limit=100",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchReleaseHistory sends no `?` with no filter", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await fetchReleaseHistory();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/releases",
      { method: "GET", idempotent: true },
    ]);
  });

  it("a non-2xx rejects with the httpClient error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 502 }));
    await expect(fetchReleaseHistory({ limit: 100 })).rejects.toThrow(
      "GET /api/v1/operations/releases?limit=100 failed: 502 - down"
    );
  });
});
