/**
 * The PRIMARY admin connect CTA must mint a connect-state token before it
 * navigates to GitHub.
 *
 * Why this file exists per-site rather than one aggregate test (plan
 * `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §6): three
 * independent entry points build the GitHub URL, and before this change TWO of
 * them minted nothing at all — this one hardcoded `installations/new` with no
 * `state` whatsoever, which is the live entry point for the exploit-#1 CSRF. A
 * single aggregate test would have passed on the one site that already minted a
 * nonce and missed the two that mattered.
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

import { ConnectGitHubOrg } from "./ConnectGitHubOrg";

// `test-token-` prefix is load-bearing, not cosmetic: a bare hex literal trips
// gitleaks' `generic-api-key` rule, and `.gitleaks.toml` already exempts
// `test[-_]?token`. Naming the fake keeps the secret scan green without
// weakening it. Keep the prefix and keep the value wire-safe (no `~`).
const TOKEN = "test-token-connect-state-github-org-0123456789abcdef";

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
});

describe("<ConnectGitHubOrg> install CTA", () => {
  it("mints a connect state and carries it as the 4th `state` segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectGitHubOrg />);

    await userEvent.click(screen.getByTestId("connect-github-org-install"));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    // The mint went to the web proxy for coord's tenant-gated mint.
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/v1/operations/pr-merge/onboarding/connect-state"
    );

    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/apps/qontinui-merge-orchestrator/installations/new"
    );
    const segments = (url.searchParams.get("state") ?? "").split("~");
    // `<flow>~<login>~<nonce>~<connect_state>` — the token must be APPENDED,
    // never substituted for the flow marker / login / nonce.
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe("connect");
    expect(segments[2]).toMatch(/^[0-9a-f]{32}$/);
    expect(segments[3]).toBe(TOKEN);
  });

  it("mints with flow=connect and no invented target", async () => {
    // The flow is what coord turns into `bind_only`; this is the bind+enroll
    // path, so it must arrive as `connect`. The target is genuinely unknown
    // here — GitHub names the installation only in its post-install redirect,
    // i.e. after this mint — so nothing may be guessed for it.
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));
    render(<ConnectGitHubOrg />);

    await userEvent.click(screen.getByTestId("connect-github-org-install"));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    expect(mintBody()).toEqual({ flow: "connect" });
  });

  it("shows a retryable error and does NOT navigate when the mint fails", async () => {
    // Falling back to a stateless install URL would spend the user's GitHub
    // round-trip on a connect coord will refuse to complete.
    fetchMock.mockResolvedValue(jsonResponse({ detail: "coord down" }, 502));
    render(<ConnectGitHubOrg />);

    await userEvent.click(screen.getByTestId("connect-github-org-install"));

    expect(
      await screen.findByTestId("connect-github-org-install-error")
    ).toHaveTextContent("502");
    expect(assign).not.toHaveBeenCalled();
    // Still clickable for the retry.
    expect(screen.getByTestId("connect-github-org-install")).not.toBeDisabled();
  });
});
