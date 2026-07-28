/**
 * The runner clone-picker connect entry must mint a connect-state token AND
 * keep its `runner-clone` flow marker.
 *
 * This page previously used a module-level `const INSTALL_URL` carrying the bare
 * legacy `state=runner-clone` — a module-import-time constant, which is exactly
 * the shape that cannot await a mint. The regression to guard is dropping the
 * flow marker while adding the token: `runner-clone` is what makes the eventual
 * claim **bind-only**, so losing it would start enrolling repos and opening
 * bootstrap PRs from the clone path (plan
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

import ConnectRunnerGithubPage from "./page";

// `test-token-` prefix is load-bearing, not cosmetic: a bare hex literal trips
// gitleaks' `generic-api-key` rule, and `.gitleaks.toml` already exempts
// `test[-_]?token`. Naming the fake keeps the secret scan green without
// weakening it. Keep the prefix and keep the value wire-safe (no `~`).
const TOKEN = "test-token-connect-state-runner-clone-0123456789abcdef";

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
  // The page also renders <ConnectInstalledOrg>, which probes coord's app
  // config on mount. Route by URL so that probe can't consume the mint stub.
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes("/onboarding/connect-state")) {
      return Promise.resolve(jsonResponse({ connect_state: TOKEN }));
    }
    return Promise.resolve(jsonResponse({ oauth_configured: false }));
  });
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

describe("/connect-runner-github install CTA", () => {
  it("mints a connect state and keeps the runner-clone flow marker", async () => {
    render(<ConnectRunnerGithubPage />);

    await userEvent.click(screen.getByTestId("connect-runner-github-install"));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.pathname).toBe(
      "/apps/qontinui-merge-orchestrator/installations/new"
    );
    const segments = (url.searchParams.get("state") ?? "").split("~");
    expect(segments).toHaveLength(4);
    // bind-only marker survives the new wire format
    expect(segments[0]).toBe("runner-clone");
    expect(segments[3]).toBe(TOKEN);
  });
});
