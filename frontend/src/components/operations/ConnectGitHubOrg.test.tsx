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

const TOKEN =
  "deadbeefcafe0123456789abcdef0123456789abcdef0123456789abcdef0123";

const originalLocation = window.location;
const assign = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
