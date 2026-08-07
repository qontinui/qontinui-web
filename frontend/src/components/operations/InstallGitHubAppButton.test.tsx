/**
 * The fresh-install entry point mints at CLICK time — and refuses BEFORE the
 * mint when this browser cannot complete the connect at all.
 *
 * `InstallGitHubAppButton` is the shared "send the browser to GitHub's install
 * page" control, so both guarantees are properties of the component rather than
 * of any one page embedding it (it is also what the onboarding-status recover
 * card renders).
 *
 * The storage case is the one worth pinning: a browser that blocks
 * `sessionStorage` can never verify the CSRF nonce on the way back, so the
 * connect is dead on arrival — and every mint allocates a single-use
 * connect-state row against a per-tenant cap on live unconsumed rows. Detecting
 * only in `beginConnectState` (which runs *after* the awaited mint) would let a
 * user clicking through the failure exhaust their own workspace's quota for the
 * row TTL. Plan `2026-08-01-connect-state-residual-hardenings` P1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    get: vi.fn(),
  },
}));

import { InstallGitHubAppButton } from "./InstallGitHubAppButton";

// `test-token-` prefix is load-bearing, not cosmetic: a bare hex literal trips
// gitleaks' `generic-api-key` rule, and `.gitleaks.toml` already exempts
// `test[-_]?token`. Keep the prefix and keep the value wire-safe (no `~`).
const TOKEN = "test-token-connect-state-install-button-0123456789abcdef";
const TEST_ID = "install-github-app";

const originalLocation = window.location;
const assign = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** How many connect-state rows this click allocated in coord. */
function mintCount(): number {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes("/onboarding/connect-state")
  ).length;
}

function blockSessionStorage(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  sessionStorage.clear();
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
  vi.restoreAllMocks();
});

describe("<InstallGitHubAppButton>", () => {
  it("mints on click and navigates to the install URL carrying the token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));
    render(<InstallGitHubAppButton flow="connect" testId={TEST_ID} />);

    await userEvent.click(screen.getByTestId(TEST_ID));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/apps/qontinui-merge-orchestrator/installations/new"
    );
    const segments = (url.searchParams.get("state") ?? "").split("~");
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe("connect");
    expect(segments[3]).toBe(TOKEN);
  });

  it("refuses BEFORE minting when the browser blocks session storage", async () => {
    // The mint is stubbed to SUCCEED, so a regression that dropped the probe
    // would show up here as an allocated row rather than as a silent pass.
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));
    blockSessionStorage();
    render(<InstallGitHubAppButton flow="connect" testId={TEST_ID} />);

    await userEvent.click(screen.getByTestId(TEST_ID));

    expect(await screen.findByTestId(`${TEST_ID}-error`)).toHaveTextContent(
      /session storage/i
    );
    // The whole point: nothing was spent on a connect that cannot complete.
    expect(mintCount()).toBe(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it("allocates no row per retry, so repeated clicks can't exhaust the quota", async () => {
    // The failure mode the probe exists for: without it, each click would mint,
    // and a per-tenant cap on live unconsumed rows would lock the workspace out
    // of connecting for the rest of the row TTL.
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));
    blockSessionStorage();
    render(<InstallGitHubAppButton flow="runner-clone" testId={TEST_ID} />);

    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getByTestId(TEST_ID));
      // The button re-enables after each failure, so the next click is real.
      await screen.findByTestId(`${TEST_ID}-error`);
    }

    expect(mintCount()).toBe(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it("still surfaces a mint failure retryably, without navigating", async () => {
    // The pre-existing contract the storage guard rides on: one `catch`, one
    // inline retryable error, no fallback to a stateless install URL.
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "coord is not reachable" }, 502)
    );
    render(<InstallGitHubAppButton flow="connect" testId={TEST_ID} />);

    await userEvent.click(screen.getByTestId(TEST_ID));

    expect(await screen.findByTestId(`${TEST_ID}-error`)).toHaveTextContent(
      "502"
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
