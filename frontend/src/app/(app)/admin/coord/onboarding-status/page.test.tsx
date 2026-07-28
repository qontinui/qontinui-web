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

const TOKEN =
  "feedface0123456789abcdef0123456789abcdef0123456789abcdef01234567";
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
