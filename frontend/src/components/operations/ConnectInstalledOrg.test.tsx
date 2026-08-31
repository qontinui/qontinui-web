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
    render(
      <ConnectInstalledOrg flow="runner-clone" runnerState={runnerNonce} />
    );

    await userEvent.type(
      await screen.findByTestId("connect-installed-org-login"),
      "acme-org"
    );
    await userEvent.click(
      screen.getByTestId("connect-installed-org-authorize")
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const segments = (
      new URL(assign.mock.calls[0][0] as string).searchParams.get("state") ?? ""
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
      new URL(assign.mock.calls[0][0] as string).searchParams.get("state") ?? ""
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
