import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prMerge` function's exact request: the RELATIVE URL written out
 * as a LITERAL (so a change to the shared base cannot move every expectation
 * with it), the method, the body's exact key order, and the retry policy the
 * route walker cannot see. `toEqual` on the whole options object keeps them
 * that way unless a change says so.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchMergeSlo,
  fetchRepoProfile,
  fetchTenantRepos,
  fetchTenantSettings,
  fireKillSwitch,
  patchRepoProfile,
  patchTenantSettings,
  setMergeEnabled,
} = await import("./prMerge");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const TENANT_PATCH = {
  min_green_dwell_secs: 60,
  confidence_threshold: 0.85,
  auto_merge_enabled: false,
  auto_fix_red_main: true,
  audit_confidence_shadow_floor: 0.5,
  escalate_paths: ["a/**"],
};

describe("prMerge", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchTenantSettings GETs /pr-merge/settings, declared idempotent, and parses the body", async () => {
    const body = { tenant_id: "t-1", profile: { repo: "" } };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTenantSettings()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchTenantSettings rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "no" }, 403));
    const err = await fetchTenantSettings().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/pr-merge/settings failed: 403 - {"detail":"no"}'
    );
    expect(httpStatusOf(err)).toBe(403);
  });

  it("patchTenantSettings PATCHes the body as the caller built it, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ tenant_id: "t-1" }));
    await patchTenantSettings(TENANT_PATCH);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      {
        method: "PATCH",
        body:
          '{"min_green_dwell_secs":60,"confidence_threshold":0.85,' +
          '"auto_merge_enabled":false,"auto_fix_red_main":true,' +
          '"audit_confidence_shadow_floor":0.5,"escalate_paths":["a/**"]}',
        idempotent: false,
      },
    ]);
  });

  it("patchTenantSettings resolves on a 2xx whose body does not parse, and rejects a non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(patchTenantSettings(TENANT_PATCH)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const err = await patchTenantSettings(TENANT_PATCH).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(500);
  });

  it("fetchTenantRepos GETs /pr-merge/repos, declared idempotent, and parses the body", async () => {
    const body = { repos: [], total: 0 };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTenantRepos()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/repos",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchMergeSlo GETs /pr-merge/slo, declared idempotent, and parses the body", async () => {
    const body = { tenant_id: "t-1", repos: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMergeSlo()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/slo",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchRepoProfile GETs the repo's profile with the slash left as a path separator", async () => {
    const body = { repo: "acme/web", merge_enabled_override: null };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchRepoProfile("acme/web")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/repos/acme/web/profile",
      { method: "GET", idempotent: true },
    ]);
  });

  it("patchRepoProfile PATCHes only the keys given, never re-sent on a 5xx", async () => {
    const body = { repo: "acme/web", merge_enabled_override: null };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(
      patchRepoProfile("acme/web", {
        confidence_threshold_override: null,
        escalate_paths_extra: [],
      })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/repos/acme/web/profile",
      {
        method: "PATCH",
        body: '{"confidence_threshold_override":null,"escalate_paths_extra":[]}',
        idempotent: false,
      },
    ]);
  });

  it("patchRepoProfile resolves null for a 2xx with an unusable body, and rejects a non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(patchRepoProfile("acme/web", {})).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const err = await patchRepoProfile("acme/web", {}).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "PATCH /api/v1/operations/pr-merge/repos/acme/web/profile failed: 500 - nope"
    );
  });

  it("setMergeEnabled POSTs scope, enabled, reason in that order, never re-sent on a 5xx", async () => {
    const body = {
      scope: "repo:acme/web",
      previous_merge_enabled: null,
      merge_enabled: true,
      affected_repos: ["acme/web"],
    };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(
      setMergeEnabled({ scope: "repo:acme/web", enabled: true, reason: "go" })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/merge-enabled",
      {
        method: "POST",
        body: '{"scope":"repo:acme/web","enabled":true,"reason":"go"}',
        idempotent: false,
      },
    ]);
  });

  it("setMergeEnabled sends a cleared pin as an explicit null", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await setMergeEnabled({ scope: "tenant", enabled: null, reason: "r" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(
      '{"scope":"tenant","enabled":null,"reason":"r"}'
    );
  });

  it("fireKillSwitch POSTs scope and reason only, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ affected_repos: [] }));
    await fireKillSwitch({ scope: "tenant", reason: "incident" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/kill-switch",
      {
        method: "POST",
        body: '{"scope":"tenant","reason":"incident"}',
        idempotent: false,
      },
    ]);
  });

  it("fireKillSwitch rejects a non-2xx so the caller can word it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 503 }));
    const err = await fireKillSwitch({ scope: "tenant", reason: "r" }).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});

describe("prMerge writes whose result is discarded", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each([
    [
      "setMergeEnabled",
      () => setMergeEnabled({ scope: "tenant", enabled: true, reason: "r" }),
    ],
    ["fireKillSwitch", () => fireKillSwitch({ scope: "tenant", reason: "r" })],
  ])(
    "%s treats a 204 or an unparseable 2xx as success, not a failure",
    async (_name, call) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(call()).resolves.toBeNull();
      fetchMock.mockResolvedValueOnce(
        new Response("not json", { status: 200 })
      );
      await expect(call()).resolves.toBeNull();
      fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
      await expect(call()).rejects.toThrow(/failed: 500/);
    }
  );
});
