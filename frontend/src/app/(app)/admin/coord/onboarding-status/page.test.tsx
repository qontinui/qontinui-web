/**
 * The claim callback must FORWARD the connect-state token and FAIL CLOSED
 * without one.
 *
 * The bypass this pins shut (plan
 * `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §1, exploit #1 —
 * live in prod before this change): `consumeNonce(null)` returned `true`, so a
 * callback carrying only `?code=&installation_id=` and NO `state` was claimed
 * anyway — binding the org the URL named into whichever tenant happened to have
 * this admin page open. A CSRF'd coord admin was enough.
 *
 * The replacement is not a bare rejection: an admin who installed the App from
 * GitHub's Marketplace legitimately arrives with no state, so the fail-closed
 * branch renders a restartable "start the connect again" card.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    get: vi.fn(),
  },
}));

// Not under test — they do their own coord reads on mount.
vi.mock("@/components/operations/OnboardingDoctor", () => ({
  OnboardingDoctor: () => null,
}));
vi.mock("@/components/operations/ConnectedOrgs", () => ({
  ConnectedOrgs: () => null,
}));

import OnboardingStatusPage from "./page";

// `test-token-` prefix is load-bearing, not cosmetic: a bare hex literal is
// what gitleaks' `generic-api-key` rule looks for, and `.gitleaks.toml` already
// exempts `test[-_]?token`. Naming the fake keeps the secret scan green without
// weakening it. Keep the prefix and keep the value wire-safe (no `~`).
const TOKEN = "test-token-connect-state-onboarding-status-0123456789abcdef";
const NONCE = "00112233445566778899aabbccddeeff";

const originalLocation = window.location;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The claim POST body the page sent, parsed. */
function claimBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/onboarding/claim")
  );
  if (!call) throw new Error("no claim POST was issued");
  return JSON.parse((call[1] as RequestInit).body as string);
}

/** The connect-state mint body the recovery card sent, parsed. */
function mintBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/onboarding/connect-state")
  );
  if (!call) throw new Error("no connect-state mint was requested");
  return JSON.parse(String((call[1] as RequestInit).body ?? "{}"));
}

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
  mockSearchParams = new URLSearchParams();
  Object.defineProperty(window, "location", {
    value: {
      ...originalLocation,
      assign: vi.fn(),
      href: "https://qontinui.io/",
    },
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
});

describe("onboarding-status claim", () => {
  it("forwards the connect_state token from `state` on the claim", async () => {
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "4242",
      state: `connect~~${NONCE}~${TOKEN}`,
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        account_login: "acme",
        installation_id: 4242,
        tenant_id: "t-1",
      })
    );

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-success");
    const body = claimBody();
    expect(body.connect_state).toBe(TOKEN);
    expect(body.installation_id).toBe(4242);
  });

  // The two segments the token now shares `state` with are BOTH consumed here.
  // The per-site tests pin what goes OUT to GitHub; these pin what comes back
  // in, so a mis-indexed `parseConnectState` can't ship green.

  it("keeps bind_only on the runner-clone flow", async () => {
    // Losing this makes the clone-only connect enroll repos and open bootstrap
    // PRs against the user's org — a production break, not a cosmetic one.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "4242",
      state: `runner-clone~~${NONCE}~${TOKEN}`,
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        account_login: "acme",
        installation_id: 4242,
        tenant_id: "t-1",
      })
    );

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-success");
    const body = claimBody();
    expect(body.bind_only).toBe(true);
    expect(body.connect_state).toBe(TOKEN);
  });

  it("uses the login from `state` as the target when GitHub sent no installation_id", async () => {
    // The authorize (already-installed org) path — GitHub issues a code but no
    // installation_id, so the org rides in `state`. Dropping it would 400
    // `target_required` on every already-installed connect.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      state: `connect~acme-org~${NONCE}~${TOKEN}`,
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        account_login: "acme-org",
        installation_id: 7,
        tenant_id: "t-1",
      })
    );

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-success");
    const body = claimBody();
    expect(body.account_login).toBe("acme-org");
    expect(body).not.toHaveProperty("installation_id");
    expect(body.connect_state).toBe(TOKEN);
  });

  it("does NOT claim a stateless callback — renders the restart path instead", async () => {
    mockSearchParams = new URLSearchParams({
      code: "gho_attacker_code",
      installation_id: "9999",
    });

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-recover");
    // The whole point: no claim POST was made at all.
    expect(
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/onboarding/claim")
      )
    ).toHaveLength(0);
    // …and the recovery is a working way back into the connect flow.
    expect(
      screen.getByTestId("onboarding-claim-recover-install")
    ).toBeInTheDocument();
  });

  it("does NOT claim when the nonce doesn't match this browser session", async () => {
    sessionStorage.setItem(
      "qontinui.onboarding_connect_nonce",
      "a-different-one"
    );
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "4242",
      state: `connect~~${NONCE}~${TOKEN}`,
    });

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-recover");
    expect(
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/onboarding/claim")
      )
    ).toHaveLength(0);
  });

  // `connect_state_required` is the code the out-of-band-install path produces
  // once coord arms the flag — the one legitimate flow this fix breaks, so it
  // must be asserted, not just its sibling.
  it.each(["connect_state_required", "connect_state_invalid"])(
    "renders coord's 400 %s as recoverable, not an error",
    async (code) => {
      sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
      mockSearchParams = new URLSearchParams({
        code: "gho_code",
        installation_id: "4242",
        state: `connect~~${NONCE}~${TOKEN}`,
      });
      fetchMock.mockResolvedValue(jsonResponse({ error: code }, 400));

      render(<OnboardingStatusPage />);

      await screen.findByTestId("onboarding-claim-recover");
      await waitFor(() =>
        expect(screen.queryByTestId("onboarding-claim-error")).toBeNull()
      );
    }
  );

  it("keeps an unrelated 400 that merely mentions the code as an error", async () => {
    // The recoverable/non-recoverable split decides whether the operator is told
    // "retry" or "you aren't an admin", so it must key on the code FIELD, not on
    // the code appearing anywhere in the body.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "4242",
      state: `connect~~${NONCE}~${TOKEN}`,
    });
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: "validation_error",
          message: "unknown field connect_state_required",
        },
        400
      )
    );

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-error");
    expect(screen.queryByTestId("onboarding-claim-recover")).toBeNull();
  });

  it("keeps a genuine gate failure as an error (not a restart prompt)", async () => {
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "4242",
      state: `connect~~${NONCE}~${TOKEN}`,
    });
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "installation_not_administered" }, 403)
    );

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-error");
    expect(screen.queryByTestId("onboarding-claim-recover")).toBeNull();
  });
});

/**
 * The live OAuth `code` and the live connect-state token must leave the URL on
 * EVERY outcome, not just the resolving-claim ones.
 *
 * Three exits used to return without stripping — the hard claim error, the
 * malformed-`installation_id` early return, and the async `catch` — leaving both
 * credentials in the address bar, in browser history, and in the `Referer` of
 * everything the page then renders (`OnboardingDoctor` mounts on the error
 * path). The fix strips once, unconditionally, up front; these tests pin that
 * shape rather than the enumeration it replaced, which was already wrong once
 * (plan `2026-08-01-connect-state-residual-hardenings` P2 / F7).
 */
describe("claim params are stripped on every exit", () => {
  /** Point `window.location` at a real claim callback URL and track replaceState. */
  function withCallbackUrl(search: string): { current: () => string } {
    const href = `https://qontinui.io/admin/coord/onboarding-status?${search}`;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: vi.fn(), href },
      writable: true,
    });
    // `stripClaimParamsFromUrl` uses history.replaceState (deliberately — a
    // Next.js navigation would remount and re-fire the claim), so the rewritten
    // URL only ever shows up there.
    let latest = href;
    vi.spyOn(window.history, "replaceState").mockImplementation(
      (_state, _unused, url) => {
        latest = String(url);
      }
    );
    return { current: () => latest };
  }

  function assertNoCredentials(url: string): void {
    const params = new URL(url).searchParams;
    expect(params.get("code")).toBeNull();
    expect(params.get("state")).toBeNull();
    // The non-credential params are NOT collateral damage.
    expect(params.get("installation_id")).not.toBeNull();
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops code + state after a hard 403 claim error", async () => {
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    const search = `code=gho_code&installation_id=4242&state=connect~~${NONCE}~${TOKEN}`;
    const url = withCallbackUrl(search);
    mockSearchParams = new URLSearchParams(search);
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "installation_not_administered" }, 403)
    );

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-error");
    assertNoCredentials(url.current());
  });

  it("drops code + state on the malformed installation_id return", async () => {
    // The exit a `finally` on the async IIFE would have missed entirely: this
    // returns before that IIFE is ever created, and it consumes nothing — so the
    // code is still UNSPENT and the token still live for the rest of its TTL.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    const search = `code=gho_code&installation_id=not-a-number&state=connect~~${NONCE}~${TOKEN}`;
    const url = withCallbackUrl(search);
    mockSearchParams = new URLSearchParams(search);

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-error");
    expect(
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/onboarding/claim")
      )
    ).toHaveLength(0);
    assertNoCredentials(url.current());
  });

  it("drops code + state when the claim POST itself throws", async () => {
    // The `catch` arm — a flaky network hits this one most often.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    const search = `code=gho_code&installation_id=4242&state=connect~~${NONCE}~${TOKEN}`;
    const url = withCallbackUrl(search);
    mockSearchParams = new URLSearchParams(search);
    fetchMock.mockRejectedValue(new Error("network down"));

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-error");
    assertNoCredentials(url.current());
  });

  it("has ALREADY stripped the URL by the time the claim POST is issued", async () => {
    // This is the assertion that pins the strip-up-front shape specifically: a
    // `finally` (or a call on each error return) would still be carrying both
    // credentials in the address bar for the whole duration of the round-trip.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", NONCE);
    const search = `code=gho_code&installation_id=4242&state=connect~~${NONCE}~${TOKEN}`;
    const url = withCallbackUrl(search);
    mockSearchParams = new URLSearchParams(search);

    let urlAtPost: string | null = null;
    fetchMock.mockImplementation((requested: string) => {
      if (String(requested).includes("/onboarding/claim")) {
        urlAtPost = url.current();
      }
      return Promise.resolve(
        jsonResponse({
          ok: true,
          account_login: "acme",
          installation_id: 4242,
          tenant_id: "t-1",
        })
      );
    });

    render(<OnboardingStatusPage />);

    await screen.findByTestId("onboarding-claim-success");
    expect(urlAtPost).not.toBeNull();
    assertNoCredentials(String(urlAtPost));
    // …and the claim still carried the token it read BEFORE the strip, so
    // stripping early cannot starve the request it precedes.
    expect(claimBody().connect_state).toBe(TOKEN);
  });
});

/**
 * The recovery card is the FOURTH connect-initiation site, and the only one
 * that *computes* its flow instead of hardcoding it. Inverting that ternary is
 * the cheapest possible regression in this feature — it would silently upgrade
 * a clone-only connect to the bind + enroll + bootstrap-PR flow, and coord now
 * records that server-side and authorises the claim from it. Both branches are
 * pinned on the actual mint payload.
 */
describe("recovery card re-mint", () => {
  function stubMint() {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/onboarding/connect-state")
          ? jsonResponse({ connect_state: TOKEN })
          : jsonResponse({ ok: true })
      )
    );
  }

  it("re-mints the runner-clone flow when that is what came back", async () => {
    // A legacy bare `runner-clone` state parses but carries no token, so the
    // page fails closed onto the recovery card with the flow still known.
    stubMint();
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "4242",
      state: "runner-clone",
    });

    render(<OnboardingStatusPage />);

    await userEvent.click(
      await screen.findByTestId("onboarding-claim-recover-install")
    );
    await waitFor(() => expect(mintBody()).toEqual({ flow: "runner-clone" }));
  });

  it("re-mints the connect flow for a stateless callback", async () => {
    // No state at all — an out-of-band Marketplace install or a crafted link.
    // The originating flow is genuinely unknowable here, and this page is the
    // merge-orchestrator onboarding surface, so `connect` is the intended
    // default. It is NOT an escalation: `/admin/coord/onboarding` renders the
    // same `connect` CTA to exactly the same audience (the /admin/coord layout
    // admits any authenticated tenant member, gating only mutations), so this
    // grants nothing the user could not already ask for directly.
    stubMint();
    mockSearchParams = new URLSearchParams({
      code: "gho_code",
      installation_id: "9999",
    });

    render(<OnboardingStatusPage />);

    await userEvent.click(
      await screen.findByTestId("onboarding-claim-recover-install")
    );
    await waitFor(() => expect(mintBody()).toEqual({ flow: "connect" }));
  });
});
