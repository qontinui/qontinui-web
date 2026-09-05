/**
 * The authorize (already-installed org) path must mint at CLICK time.
 *
 * This is the only one of the three initiation sites that already minted a CSRF
 * nonce — but it did so **during render**, inside the `<a href>` expression, so
 * every keystroke in the org field replaced the stored nonce and only the last
 * one could ever match. A network mint cannot happen there at all. The
 * regression this pins: the outbound authorize URL is built after an awaited
 * mint and carries the token as the 4th `state` segment (plan
 * `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §4 P2).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    get: vi.fn(),
  },
}));

import { ConnectInstalledOrg } from "./ConnectInstalledOrg";

// `test-token-` prefix is load-bearing, not cosmetic: a bare hex literal trips
// gitleaks' `generic-api-key` rule, and `.gitleaks.toml` already exempts
// `test[-_]?token`. Naming the fake keeps the secret scan green without
// weakening it. Keep the prefix and keep the value wire-safe (no `~`).
const TOKEN = "test-token-connect-state-installed-org-abcdef0123456789";
const APP_CONFIG = {
  app_slug: "qontinui-merge-orchestrator",
  client_id: "Iv1.testclientid",
  oauth_configured: true,
};

const originalLocation = window.location;
const assign = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The JSON body of the connect-state mint request, as actually sent. */
function mintBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/onboarding/connect-state")
  );
  if (!call) throw new Error("no connect-state mint was requested");
  return JSON.parse(String((call[1] as { body?: string }).body ?? "{}"));
}

function stubFetch(mintResponse: Response) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).includes("/onboarding/connect-state")
        ? mintResponse
        : jsonResponse(APP_CONFIG)
    )
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, assign, href: "https://qontinui.io/" },
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
  // The storage-blocked test spies on `Storage.prototype`; leaving that in place
  // would break every later suite in this file.
  vi.restoreAllMocks();
});

describe("<ConnectInstalledOrg> authorize CTA", () => {
  it("mints on click and appends the token to the state wire format", async () => {
    stubFetch(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectInstalledOrg flow="connect" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    await userEvent.type(input, "acme-org");
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(url.searchParams.get("client_id")).toBe(APP_CONFIG.client_id);
    const segments = (url.searchParams.get("state") ?? "").split("~");
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe("connect");
    // The login is the claim TARGET on this path (no installation_id exists),
    // so it must survive alongside the token.
    expect(segments[1]).toBe("acme-org");
    expect(segments[3]).toBe(TOKEN);
  });

  it("carries the runner-clone flow marker through", async () => {
    stubFetch(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectInstalledOrg flow="runner-clone" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org"
    );
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const state =
      new URL(assign.mock.calls[0][0] as string).searchParams.get("state") ??
      "";
    expect(state.split("~")[0]).toBe("runner-clone");
    // Full body, not just `.flow`: this site sends the target on BOTH flows, so
    // a property probe would miss a regression that dropped it on this one.
    expect(mintBody()).toEqual({
      flow: "runner-clone",
      target_login: "acme-org",
    });
  });

  it("mints with flow=connect AND the entered org as the target", async () => {
    // This is the one initiation site where the target is known before the
    // GitHub hop — the user typed it and `isValidLogin` validated it — so the token
    // is bound to that org rather than authorising a claim of any org the
    // caller happens to be able to reach.
    stubFetch(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectInstalledOrg flow="connect" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org"
    );
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(mintBody()).toEqual({ flow: "connect", target_login: "acme-org" });
  });

  it("appends the runner return-nonce as wire-format slot 5 when supplied", async () => {
    // P2 runner-native hand-off: `/connect-runner-github` threads the runner's
    // return nonce down as a prop. This pins that `beginConnectState` actually
    // receives it on the authorize path too, not just the install-button path.
    stubFetch(jsonResponse({ connect_state: TOKEN }));
    const runnerNonce = "b".repeat(64);
    render(<ConnectInstalledOrg flow="runner-clone" runnerState={runnerNonce} />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org"
    );
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const segments = (
      new URL(assign.mock.calls[0][0] as string).searchParams.get("state") ??
      ""
    ).split("~");
    expect(segments).toHaveLength(5);
    expect(segments[4]).toBe(runnerNonce);
  });

  it("keeps the 4-field shape when no runner return-nonce is supplied", async () => {
    stubFetch(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectInstalledOrg flow="connect" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org"
    );
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const segments = (
      new URL(assign.mock.calls[0][0] as string).searchParams.get("state") ??
      ""
    ).split("~");
    expect(segments).toHaveLength(4);
  });

  it("surfaces a mint failure without navigating", async () => {
    stubFetch(jsonResponse({ detail: "coord is not reachable" }, 502));
    render(<ConnectInstalledOrg flow="connect" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org"
    );
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    expect(
      await screen.findByTestId("connect-installed-org-error")
    ).toHaveTextContent("502");
    expect(assign).not.toHaveBeenCalled();
  });

  it("refuses BEFORE minting when the browser blocks session storage", async () => {
    // A storage-blocked browser can never complete this connect (the callback
    // nonce is unverifiable), so it must not allocate a single-use
    // connect-state row in coord on the way to finding that out — a row nothing
    // will ever consume, one more per retry. `beginConnectState` throws too, but
    // only after the mint, hence the probe ahead of it.
    stubFetch(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectInstalledOrg flow="connect" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    await userEvent.type(input, "acme-org");
    // Block only AFTER the config fetch + typing, so the failure under test is
    // the connect click and nothing else.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    expect(
      await screen.findByTestId("connect-installed-org-error")
    ).toHaveTextContent(/session storage/i);
    // The assertion that matters: no mint was requested at all.
    expect(
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/onboarding/connect-state")
      )
    ).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });
});

/**
 * P1 of plan `2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility`:
 * the typed org is pre-checked against coord's keyed pending-installation
 * read, and the four verdicts render inline. The pre-check informs the click
 * and never gates it; UNKNOWN is never rendered as "not installed".
 */
describe("<ConnectInstalledOrg> pending-installation pre-check", () => {
  const RECEIVED = "2026-09-05T10:11:12Z";

  function stubWithPending(body: unknown, status = 200) {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/onboarding/pending-installation")) {
        return Promise.resolve(jsonResponse(body, status));
      }
      if (u.includes("/onboarding/connect-state")) {
        return Promise.resolve(jsonResponse({ connect_state: TOKEN }));
      }
      return Promise.resolve(jsonResponse(APP_CONFIG));
    });
  }

  function pendingCalls() {
    return fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/onboarding/pending-installation")
    );
  }

  it("checks the typed org on blur with account_login and renders the pending verdict", async () => {
    stubWithPending({
      pending: true,
      installation_id: 42,
      account_login: "acme-org",
      account_type: "Organization",
      repo_count: 3,
      received_at: RECEIVED,
      claimed_at: null,
    });
    render(<ConnectInstalledOrg flow="connect" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    await userEvent.type(input, "acme-org");
    await userEvent.tab();

    const verdict = await screen.findByTestId(
      "connect-installed-org-precheck",
      {},
      { timeout: 3000 }
    );
    await waitFor(() => expect(verdict).toHaveAttribute("data-kind", "pending"));
    expect(verdict).toHaveTextContent(/coord saw the App installed on acme-org \(3 repos\)/);
    expect(verdict).toHaveTextContent(/not connected to a tenant yet\. Connect it\./);
    const url = new URL(String(pendingCalls()[0][0]), "https://x.test");
    expect(url.searchParams.get("account_login")).toBe("acme-org");
    expect(url.searchParams.has("installation_id")).toBe(false);
    // The authorize click is NOT gated on the verdict.
    expect(
      screen.getByTestId("connect-installed-org-authorize")
    ).toBeEnabled();
  });

  it("checks immediately on Enter", async () => {
    stubWithPending({
      pending: false,
      installation_id: 42,
      account_login: "acme-org",
      account_type: "Organization",
      repo_count: 3,
      received_at: RECEIVED,
      claimed_at: "2026-09-05T12:00:00Z",
    });
    render(<ConnectInstalledOrg flow="connect" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    await userEvent.type(input, "acme-org{Enter}");

    const verdict = await screen.findByTestId("connect-installed-org-precheck");
    await waitFor(() => expect(verdict).toHaveAttribute("data-kind", "claimed"));
    expect(verdict).toHaveTextContent(/acme-org was already connected on/);
  });

  it("renders the unseen verdict with the install CTA", async () => {
    stubWithPending({
      pending: false,
      installation_id: null,
      account_login: null,
      account_type: null,
      repo_count: null,
      received_at: null,
      claimed_at: null,
    });
    render(<ConnectInstalledOrg flow="connect" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org{Enter}"
    );

    const verdict = await screen.findByTestId("connect-installed-org-precheck");
    await waitFor(() => expect(verdict).toHaveAttribute("data-kind", "unseen"));
    expect(verdict).toHaveTextContent(
      "coord has not seen an install for acme-org; install the App first."
    );
    expect(
      screen.getByTestId("connect-installed-org-precheck-install")
    ).toBeInTheDocument();
  });

  it("renders pending: null as UNKNOWN — never as not-installed", async () => {
    stubWithPending({
      pending: null,
      installation_id: null,
      account_login: null,
      account_type: null,
      repo_count: null,
      received_at: null,
      claimed_at: null,
      reason: "pending_installations_table_absent",
    });
    render(<ConnectInstalledOrg flow="connect" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org{Enter}"
    );

    const verdict = await screen.findByTestId("connect-installed-org-precheck");
    await waitFor(() => expect(verdict).toHaveAttribute("data-kind", "unknown"));
    expect(verdict).toHaveTextContent(/couldn't check with coord/);
    expect(verdict).not.toHaveTextContent(/not seen|install the App/);
    expect(
      screen.queryByTestId("connect-installed-org-precheck-install")
    ).toBeNull();
  });

  it("folds a failed proxy call into UNKNOWN and still lets the operator authorize", async () => {
    stubWithPending({ detail: "coord is not reachable" }, 502);
    render(<ConnectInstalledOrg flow="connect" />);

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org{Enter}"
    );

    const verdict = await screen.findByTestId("connect-installed-org-precheck");
    await waitFor(() => expect(verdict).toHaveAttribute("data-kind", "unknown"));
    expect(verdict).toHaveTextContent(/HTTP 502/);

    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });

  it("does not check an invalid login, and does not re-check the same login twice", async () => {
    stubWithPending({
      pending: true,
      installation_id: 42,
      account_login: "acme-org",
      account_type: "Organization",
      repo_count: 1,
      received_at: RECEIVED,
      claimed_at: null,
    });
    render(<ConnectInstalledOrg flow="connect" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    await userEvent.type(input, "-bad-{Enter}");
    expect(pendingCalls()).toHaveLength(0);
    expect(screen.queryByTestId("connect-installed-org-precheck")).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "acme-org{Enter}");
    await screen.findByTestId("connect-installed-org-precheck");
    await userEvent.type(input, "{Enter}");
    await userEvent.tab();
    expect(pendingCalls()).toHaveLength(1);
  });

  it("drops a stale verdict as soon as the field names a different org", async () => {
    stubWithPending({
      pending: true,
      installation_id: 42,
      account_login: "acme-org",
      account_type: "Organization",
      repo_count: 1,
      received_at: RECEIVED,
      claimed_at: null,
    });
    render(<ConnectInstalledOrg flow="connect" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    await userEvent.type(input, "acme-org{Enter}");
    await screen.findByTestId("connect-installed-org-precheck");

    await userEvent.type(input, "2");
    expect(screen.queryByTestId("connect-installed-org-precheck")).toBeNull();
  });

  it("prefills from defaultOrg and checks on mount (the ?connect= hand-off)", async () => {
    stubWithPending({
      pending: true,
      installation_id: 42,
      account_login: "portofino-pizzeria",
      account_type: "Organization",
      repo_count: 2,
      received_at: RECEIVED,
      claimed_at: null,
    });
    render(<ConnectInstalledOrg flow="connect" defaultOrg="portofino-pizzeria" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    expect(input).toHaveValue("portofino-pizzeria");
    const verdict = await screen.findByTestId("connect-installed-org-precheck");
    await waitFor(() => expect(verdict).toHaveAttribute("data-kind", "pending"));
    expect(verdict).toHaveTextContent(/portofino-pizzeria \(2 repos\)/);
    const url = new URL(String(pendingCalls()[0][0]), "https://x.test");
    expect(url.searchParams.get("account_login")).toBe("portofino-pizzeria");
    // The only remaining action is the click — it is live.
    expect(
      screen.getByTestId("connect-installed-org-authorize")
    ).toBeEnabled();
  });

  it("ignores a defaultOrg that is not a valid login", async () => {
    stubWithPending({ pending: true });
    render(<ConnectInstalledOrg flow="connect" defaultOrg="not a login!" />);

    const input = await screen.findByTestId("connect-installed-org-login");
    expect(input).toHaveValue("");
    expect(pendingCalls()).toHaveLength(0);
  });
});
