import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prMergeOnboarding` function's exact request: the RELATIVE URL as
 * a LITERAL, the method, the body and the retry policy the route walker cannot
 * see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const onboarding = await import("./prMergeOnboarding");

describe("prMergeOnboarding", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("enroll and restore POST once, never re-sent", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await onboarding.postOnboardingEnroll(42);
    await onboarding.postOnboardingRestore("acme/web");
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/pr-merge/onboarding/installations/42/enroll",
        { method: "POST", maxRetries: 0 },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/repos/acme/web/restore",
        { method: "POST", maxRetries: 0 },
      ],
    ]);
  });

  it("fetchOnboardingAccounts parses the body; only the polled read drops client retries", async () => {
    const body = { accounts: [] };
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body)))
    );
    await expect(onboarding.fetchOnboardingAccounts(false)).resolves.toEqual(
      body
    );
    await onboarding.fetchOnboardingAccounts(true);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/pr-merge/onboarding/accounts", { method: "GET" }],
      [
        "/api/v1/operations/pr-merge/onboarding/accounts",
        { method: "GET", maxRetries: 0 },
      ],
    ]);
  });

  it("fetchOnboardingDoctor encodes the repo and rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad repo", { status: 422 }));
    const err = await onboarding
      .fetchOnboardingDoctor("acme/web")
      .catch((e: unknown) => e);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/doctor?repo=acme%2Fweb",
      { method: "GET" },
    ]);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/pr-merge/onboarding/doctor?repo=acme%2Fweb failed: 422 - bad repo"
    );
    expect(httpStatusOf(err)).toBe(422);
  });

  it("the wizard's requests hit their routes", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await onboarding.fetchOnboardingGithubApp();
    await onboarding.postDevicePairStart({ callback_url: "u" });
    await onboarding.postOnboardingAudit("acme/web");
    await onboarding.fetchOnboardingAuditStatus("a b");
    await onboarding.postOnboardingAccept({ repo: "acme/web" });
    await onboarding.fetchOnboardingPreconditionStatus();
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/pr-merge/onboarding/github-app"],
      [
        "/api/v1/operations/coord/devices/pair-start",
        { method: "POST", body: JSON.stringify({ callback_url: "u" }) },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/audit",
        { method: "POST", body: JSON.stringify({ repo: "acme/web" }) },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/audit-status?agent_id=a%20b",
        { method: "GET", maxRetries: 0 },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/accept",
        { method: "POST", body: JSON.stringify({ repo: "acme/web" }) },
      ],
      [
        "/api/v1/operations/pr-merge/onboarding/precondition-status",
        { method: "GET", maxRetries: 0 },
      ],
    ]);
  });
});
