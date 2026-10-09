import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `releases` function's exact request: the RELATIVE URL written out
 * as a LITERAL, the `encodeURIComponent` of the tag, the optional query, and
 * the `httpClient.fetch` options (method, idempotent).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchRelease, fetchReleaseHistory } = await import("./releases");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("releases", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchReleaseHistory GETs /releases with no query when none is given", async () => {
    const body = { history: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchReleaseHistory()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/releases",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchReleaseHistory sends repo and limit, carrying the caller options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ history: [] }));
    await fetchReleaseHistory(
      { repo: "qontinui/qontinui-runner", limit: 100 },
      { maxRetries: 0 }
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/releases?repo=qontinui%2Fqontinui-runner&limit=100",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchRelease GETs the encoded tag, with the repo when given", async () => {
    fetchMock.mockImplementation(async () => answer({ tag: "v/1 2" }));
    await fetchRelease("v/1 2");
    await fetchRelease("v/1 2", { repo: "a/b" });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/releases/v%2F1%202",
        { method: "GET", idempotent: true },
      ],
      [
        "/api/v1/operations/releases/v%2F1%202?repo=a%2Fb",
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("rejects a non-2xx in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "nope" }, 404));
    const err = await fetchRelease("v1").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/releases/v1 failed: 404 - {"detail":"nope"}'
    );
  });
});
