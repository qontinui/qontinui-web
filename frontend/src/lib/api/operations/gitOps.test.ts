import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchGitOpsList, fetchGitOpsBranches } = await import("./gitOps");

describe("gitOps", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchGitOpsList GETs /git-ops/list with no retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ops: [] })));
    await expect(
      fetchGitOpsList(new URLSearchParams({ limit: "200" }))
    ).resolves.toEqual({ ops: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/git-ops/list?limit=200",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchGitOpsBranches GETs /git-ops/branches with no retries", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ branches: [] }))
    );
    await expect(fetchGitOpsBranches()).resolves.toEqual({ branches: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/git-ops/branches",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    const err = await fetchGitOpsBranches().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(500);
  });
});
