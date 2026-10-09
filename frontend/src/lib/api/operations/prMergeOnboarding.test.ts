import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prMergeOnboarding` function's exact request: the RELATIVE URL
 * written out as a LITERAL, the `encodeURIComponent` of every encoded
 * parameter, and the `httpClient.fetch` options the route walker cannot see
 * (method, retry policy). Bodies are compared as strings, so the wire key
 * order is pinned.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  acceptOnboardingProfile,
  claimInstallation,
  coordErrorBody,
  enrollInstallation,
  fetchConnectedAccounts,
  fetchGithubAppConfig,
  fetchOnboardingAuditStatus,
  fetchOnboardingDoctor,
  fetchOnboardingPrecondition,
  fetchPendingInstallationRow,
  postConnectState,
  restoreEnrolledRepo,
  startDevicePairing,
  startOnboardingAudit,
} = await import("./prMergeOnboarding");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("prMergeOnboarding", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in the httpClient error shape and coordErrorBody reads coord's JSON refusal back", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ error: "repo_has_no_remote" }, 409)
    );
    const err = await startOnboardingAudit("acme/web").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'POST /api/v1/operations/pr-merge/onboarding/audit failed: 409 - {"error":"repo_has_no_remote"}'
    );
    expect(httpStatusOf(err)).toBe(409);
    expect(coordErrorBody(err)).toEqual({ error: "repo_has_no_remote" });
    expect(coordErrorBody(new Error("network down"))).toEqual({});
  });

  it("startDevicePairing POSTs the pair-start body in wire key order, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ state: "s" }));
    await startDevicePairing({
      web_pair_url: "w",
      device_hostname: "h",
      callback_url: "c",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/devices/pair-start",
      {
        method: "POST",
        body: '{"callback_url":"c","device_hostname":"h","web_pair_url":"w"}',
        idempotent: false,
      },
    ]);
  });

  it("fetchOnboardingPrecondition GETs precondition-status with the caller's options", async () => {
    fetchMock.mockResolvedValueOnce(answer({ paired: true }));
    await fetchOnboardingPrecondition({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/precondition-status",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("startOnboardingAudit POSTs the repo", async () => {
    fetchMock.mockResolvedValueOnce(answer({ agent_id: "a" }, 202));
    await expect(startOnboardingAudit("acme/web")).resolves.toEqual({
      agent_id: "a",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/audit",
      { method: "POST", body: '{"repo":"acme/web"}', idempotent: false },
    ]);
  });

  it("fetchOnboardingAuditStatus GETs audit-status with the agent id encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ status: "running" }));
    await fetchOnboardingAuditStatus("a/b c", { maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/audit-status?agent_id=a%2Fb%20c",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("acceptOnboardingProfile POSTs the accept body, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repo: "acme/web" }));
    await acceptOnboardingProfile({
      repo: "acme/web",
      profile: { line_budget: 5 },
      github_remote: "https://github.com/acme/web.git",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/accept",
      {
        method: "POST",
        body: '{"repo":"acme/web","profile":{"line_budget":5},"github_remote":"https://github.com/acme/web.git"}',
        idempotent: false,
      },
    ]);
  });

  it("fetchOnboardingDoctor GETs the doctor with the repo encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repo: "acme/web" }));
    await fetchOnboardingDoctor("acme/web");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/doctor?repo=acme%2Fweb",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchConnectedAccounts GETs accounts with the caller's options", async () => {
    fetchMock.mockImplementation(async () => answer({ accounts: [] }));
    await fetchConnectedAccounts({ maxRetries: 0 });
    await fetchConnectedAccounts();
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/pr-merge/onboarding/accounts",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/accounts",
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchPendingInstallationRow GETs by exactly one key, form-encoded", async () => {
    fetchMock.mockImplementation(async () => answer({ pending: true }));
    await fetchPendingInstallationRow({ installation_id: 42 });
    await fetchPendingInstallationRow({ account_login: "a b" });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/pr-merge/onboarding/pending-installation?installation_id=42",
        { method: "GET", idempotent: true },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/pending-installation?account_login=a+b",
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchGithubAppConfig GETs github-app", async () => {
    fetchMock.mockResolvedValueOnce(answer({ app_slug: "x" }));
    await fetchGithubAppConfig();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/github-app",
      { method: "GET", idempotent: true },
    ]);
  });

  it("postConnectState POSTs the mint request as one request only, null on a bodiless 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(postConnectState({ flow: "connect" })).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/connect-state",
      {
        method: "POST",
        body: '{"flow":"connect"}',
        idempotent: false,
        maxRetries: 0,
      },
    ]);
  });

  it("claimInstallation POSTs the claim body, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await claimInstallation({
      code: "c",
      installation_id: 7,
      connect_state: "s",
      bind_only: true,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/claim",
      {
        method: "POST",
        body: '{"code":"c","installation_id":7,"connect_state":"s","bind_only":true}',
        idempotent: false,
      },
    ]);
  });

  it("enrollInstallation POSTs the installation's enroll route as one request only", async () => {
    fetchMock.mockResolvedValueOnce(answer({}, 202));
    await enrollInstallation(1234);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/installations/1234/enroll",
      { method: "POST", maxRetries: 0, idempotent: false },
    ]);
  });

  it("restoreEnrolledRepo POSTs the repo's restore route, slash unencoded, as one request only", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 202 }));
    await restoreEnrolledRepo("acme/web");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/repos/acme/web/restore",
      { method: "POST", maxRetries: 0, idempotent: false },
    ]);
  });
});
