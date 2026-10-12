import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each `/repos` client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchRepos, registerRepo, removeRepo } = await import("./repos");

describe("repos", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchRepos GETs /repos, idempotent, and parses the body", async () => {
    const body = { repos: [{ repo: "a/b" }] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(fetchRepos()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      { method: "GET", idempotent: true },
    ]);
  });

  it("registerRepo POSTs the slug and is never retried", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(registerRepo("a/b")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      { method: "POST", body: '{"repo":"a/b"}', idempotent: false },
    ]);
  });

  it("removeRepo DELETEs with the slug encoded", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await removeRepo("a/b");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos?repo=a%2Fb",
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("a non-2xx rejects with the httpClient error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 409 }));
    await expect(registerRepo("a/b")).rejects.toThrow(
      "POST /api/v1/operations/repos failed: 409 - nope"
    );
  });
});
