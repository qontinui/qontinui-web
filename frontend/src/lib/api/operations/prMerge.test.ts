import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prMerge` function's exact request: the RELATIVE URL written out
 * as a LITERAL, the `encodeURIComponent` of every encoded parameter, and the
 * `httpClient.fetch` options the route walker cannot see (method, retry
 * policy). Bodies are compared as strings, so the wire key order is pinned.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  deregisterCanonicalRepo,
  fetchCanonicalRepos,
  fetchMergeSlo,
  fetchRepoMergeProfile,
  fetchTenantMergeRepos,
  fetchTenantMergeSettings,
  patchRepoMergeProfile,
  patchTenantMergeSettings,
  pauseTenantMerges,
  registerCanonicalRepo,
  writeMergeEnabled,
} = await import("./prMerge");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("prMerge", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in the httpClient error shape, naming the method", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const err = await fetchMergeSlo().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/pr-merge/slo failed: 500 - boom"
    );
    expect(httpStatusOf(err)).toBe(500);
    expect(httpBodyOf(err)).toBe("boom");
  });

  it("fetchTenantMergeSettings GETs /pr-merge/settings and carries the caller's options", async () => {
    const body = { tenant_id: "t", profile: {} };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTenantMergeSettings({ maxRetries: 0 })).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("patchTenantMergeSettings PATCHes the delta, not re-sent on a 5xx, and tolerates a bodiless 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(
      patchTenantMergeSettings({ auto_fix_pr: true })
    ).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      {
        method: "PATCH",
        body: '{"auto_fix_pr":true}',
        idempotent: false,
      },
    ]);
  });

  it("fetchTenantMergeRepos GETs /pr-merge/repos", async () => {
    const body = { repos: [], total: 0 };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTenantMergeRepos()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/repos",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchMergeSlo GETs /pr-merge/slo", async () => {
    const body = { repos: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMergeSlo()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/slo",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchRepoMergeProfile GETs the repo's profile with the owner/name slash unencoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repo: "acme/web" }));
    await fetchRepoMergeProfile("acme/web");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/repos/acme/web/profile",
      { method: "GET", idempotent: true },
    ]);
  });

  it("patchRepoMergeProfile PATCHes the delta to the repo's profile, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repo: "acme/web" }));
    await patchRepoMergeProfile("acme/web", { auto_merge_label_budget: 3 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/repos/acme/web/profile",
      {
        method: "PATCH",
        body: '{"auto_merge_label_budget":3}',
        idempotent: false,
      },
    ]);
  });

  it("writeMergeEnabled POSTs scope, enabled, reason in wire key order", async () => {
    fetchMock.mockResolvedValueOnce(answer({ scope: "repo:acme/web" }));
    // Keys deliberately out of order: the wire order must not follow them.
    await writeMergeEnabled({
      reason: "why",
      enabled: null,
      scope: "repo:acme/web",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/merge-enabled",
      {
        method: "POST",
        body: '{"scope":"repo:acme/web","enabled":null,"reason":"why"}',
        idempotent: false,
      },
    ]);
  });

  it("pauseTenantMerges POSTs the tenant scope and reason to the kill-switch", async () => {
    fetchMock.mockResolvedValueOnce(answer({ scope: "tenant" }));
    await pauseTenantMerges("incident");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/kill-switch",
      {
        method: "POST",
        body: '{"scope":"tenant","reason":"incident"}',
        idempotent: false,
      },
    ]);
  });

  it("fetchCanonicalRepos GETs /repos without the cache", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repos: [] }));
    await fetchCanonicalRepos();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        idempotent: true,
      },
    ]);
  });

  it("registerCanonicalRepo POSTs the slug, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repo: "acme/web" }));
    await registerCanonicalRepo("acme/web");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: '{"repo":"acme/web"}',
        idempotent: false,
      },
    ]);
  });

  it("deregisterCanonicalRepo DELETEs with the slug encoded into the query", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await deregisterCanonicalRepo("acme/web app");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos?repo=acme%2Fweb%20app",
      {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        idempotent: true,
      },
    ]);
  });
});
