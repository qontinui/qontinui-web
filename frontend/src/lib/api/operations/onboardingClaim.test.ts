import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the claim request and that a refusal comes back as data. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { postOnboardingClaim } = await import("./onboardingClaim");

describe("postOnboardingClaim", () => {
  afterEach(() => fetchMock.mockReset());

  it("POSTs the claim, never re-sent on a 5xx, and returns the parsed body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 })
    );
    await expect(postOnboardingClaim({ code: "c" })).resolves.toEqual({
      ok: true,
      status: 200,
      body: { ok: 1 },
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/claim",
      { method: "POST", body: '{"code":"c"}', idempotent: false },
    ]);
  });

  it("returns a non-2xx as data, with {} for an unparseable body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "claim_expired" }), { status: 410 })
    );
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(postOnboardingClaim({})).resolves.toEqual({
      ok: false,
      status: 410,
      body: { error: "claim_expired" },
    });
    await expect(postOnboardingClaim({})).resolves.toEqual({
      ok: false,
      status: 502,
      body: {},
    });
  });
});
