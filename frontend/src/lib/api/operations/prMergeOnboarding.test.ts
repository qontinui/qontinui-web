import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prMergeOnboarding` function's exact request: the RELATIVE URL
 * written out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the method, the body's exact key order, and the retry
 * policy the route walker cannot see. `toEqual` on the whole options object
 * keeps them that way unless a change says so.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  acceptStarterProfile,
  claimInstallation,
  dispatchRepoAudit,
  enrollInstallation,
  fetchAuditStatus,
  fetchGithubAppConfig,
  fetchOnboardingAccounts,
  fetchOnboardingDoctor,
  fetchPendingInstallation,
  fetchPreconditionStatus,
  mintConnectStateToken,
  restoreRepo,
  startDevicePairing,
} = await import("./prMergeOnboarding");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function rawAnswer(text: string, status: number): Response {
  return new Response(text, { status });
}

describe("prMergeOnboarding", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchGithubAppConfig GETs /pr-merge/onboarding/github-app, declared idempotent, and parses the body", async () => {
    const body = { app_slug: "qontinui", client_id: "Iv1", oauth_configured: true };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchGithubAppConfig()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/github-app",
      { method: "GET", idempotent: true },
    ]);
  });

  it("mintConnectStateToken POSTs the body as built, never retried, and parses the envelope", async () => {
    fetchMock.mockResolvedValueOnce(answer({ connect_state: "abc" }));
    await expect(
      mintConnectStateToken({ flow: "connect", target_login: "acme" })
    ).resolves.toEqual({ connect_state: "abc" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/connect-state",
      {
        method: "POST",
        body: '{"flow":"connect","target_login":"acme"}',
        idempotent: false,
        maxRetries: 0,
      },
    ]);
  });

  it("mintConnectStateToken resolves null for a 2xx whose body does not parse", async () => {
    fetchMock.mockResolvedValueOnce(rawAnswer("not json", 200));
    await expect(mintConnectStateToken({ flow: "connect" })).resolves.toBeNull();
  });

  it("mintConnectStateToken rejects a non-2xx in httpClient's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "no" }, 403));
    const err = await mintConnectStateToken({ flow: "connect" }).catch(
      (e: unknown) => e
    );
    expect((err as Error).message).toBe(
      'POST /api/v1/operations/pr-merge/onboarding/connect-state failed: 403 - {"error":"no"}'
    );
    expect(httpStatusOf(err)).toBe(403);
  });

  it("claimInstallation POSTs the claim in the caller's key order, not re-sent on a 5xx", async () => {
    const ok = {
      ok: true,
      account_login: "acme",
      installation_id: 7,
      tenant_id: "t-1",
    };
    fetchMock.mockResolvedValueOnce(answer(ok));
    await expect(
      claimInstallation({
        code: "c0de",
        installation_id: 7,
        connect_state: "tok",
        bind_only: true,
      })
    ).resolves.toEqual(ok);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/claim",
      {
        method: "POST",
        body: '{"code":"c0de","installation_id":7,"connect_state":"tok","bind_only":true}',
        idempotent: false,
      },
    ]);
  });

  it("claimInstallation carries coord's error body on a rejection, for httpBodyOf", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "connect_state_expired" }, 400));
    const err = await claimInstallation({
      code: "c",
      account_login: "acme",
      connect_state: "tok",
    }).catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(400);
    expect(httpBodyOf(err)).toBe('{"error":"connect_state_expired"}');
  });

  it("fetchOnboardingAccounts GETs /pr-merge/onboarding/accounts with the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(answer({ accounts: [] }));
    await expect(fetchOnboardingAccounts({ maxRetries: 0 })).resolves.toEqual({
      accounts: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/accounts",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("enrollInstallation POSTs the installation enroll, never retried, and accepts a bodiless 202", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(enrollInstallation(111)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/installations/111/enroll",
      { method: "POST", idempotent: false, maxRetries: 0 },
    ]);
  });

  it("restoreRepo POSTs the restore with owner/name UNENCODED (the :path converter takes the slash)", async () => {
    fetchMock.mockResolvedValueOnce(answer({ enrolled: "spawned" }, 202));
    await expect(restoreRepo("portofino/infra")).resolves.toEqual({
      enrolled: "spawned",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/repos/portofino/infra/restore",
      { method: "POST", idempotent: false, maxRetries: 0 },
    ]);
  });

  it("fetchOnboardingDoctor GETs the doctor with the repo percent-encoded in the query", async () => {
    const body = { repo: "a/b", checks: [], summary: {} };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchOnboardingDoctor("a/b")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/doctor?repo=a%2Fb",
      { method: "GET", idempotent: true },
    ]);
  });

  it("startDevicePairing POSTs /coord/devices/pair-start, not re-sent on a 5xx", async () => {
    const ok = { state: "PAIR", redirect_url: "https://x", expires_in: 600 };
    fetchMock.mockResolvedValueOnce(answer(ok));
    await expect(
      startDevicePairing({
        callback_url: "http://127.0.0.1:9876/pair-callback",
        device_hostname: "operator-workstation",
        web_pair_url: "https://qontinui.io/operations/pair-runner",
      })
    ).resolves.toEqual(ok);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/devices/pair-start",
      {
        method: "POST",
        body:
          '{"callback_url":"http://127.0.0.1:9876/pair-callback",' +
          '"device_hostname":"operator-workstation",' +
          '"web_pair_url":"https://qontinui.io/operations/pair-runner"}',
        idempotent: false,
      },
    ]);
  });

  it("fetchPreconditionStatus GETs /pr-merge/onboarding/precondition-status with the poll budget", async () => {
    const body = { paired: true, claude_code_available: true, ready: true };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchPreconditionStatus({ maxRetries: 0 })).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/precondition-status",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("dispatchRepoAudit POSTs the repo and resolves the status beside the body", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ agent_id: "ag-1", repo: "a/b", status: "running" }, 202)
    );
    await expect(dispatchRepoAudit("a/b")).resolves.toEqual({
      httpStatus: 202,
      body: { agent_id: "ag-1", repo: "a/b", status: "running" },
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/audit",
      { method: "POST", body: '{"repo":"a/b"}', idempotent: false },
    ]);
  });

  it("fetchAuditStatus GETs audit-status with the agent id percent-encoded", async () => {
    const body = { status: "running", agent_id: "a b" };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchAuditStatus("a b", { maxRetries: 0 })).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/audit-status?agent_id=a%20b",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("acceptStarterProfile POSTs the accept body as built, not re-sent on a 5xx", async () => {
    const ok = { repo: "a/b", worktree_allocation: "enabled" };
    fetchMock.mockResolvedValueOnce(answer(ok));
    await expect(
      acceptStarterProfile({
        repo: "a/b",
        profile: { line_budget: 400 },
        github_remote: "https://github.com/a/b.git",
      })
    ).resolves.toEqual(ok);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/accept",
      {
        method: "POST",
        body:
          '{"repo":"a/b","profile":{"line_budget":400},' +
          '"github_remote":"https://github.com/a/b.git"}',
        idempotent: false,
      },
    ]);
  });
});

describe("fetchPendingInstallation", () => {
  const PENDING = {
    pending: true,
    installation_id: 143833618,
    account_login: "portofino-pizzeria",
    account_type: "Organization",
    repo_count: 3,
    received_at: "2026-09-05T10:11:12Z",
    claimed_at: null,
  };

  it("sends exactly one key under coord's own query-param name", async () => {
    fetchMock.mockReset();
    // A fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(answer(PENDING)));

    await fetchPendingInstallation({ account_login: "portofino-pizzeria" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/pending-installation?account_login=portofino-pizzeria",
      { method: "GET", idempotent: true },
    ]);

    await fetchPendingInstallation({ installation_id: 143833618 });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/v1/operations/pr-merge/onboarding/pending-installation?installation_id=143833618"
    );
  });

  it("throws on a non-2xx, naming the status, so callers fold it into UNKNOWN", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer({ detail: "coord is not reachable" }, 502));
    const err = await fetchPendingInstallation({ account_login: "acme" }).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(502);
  });
});
