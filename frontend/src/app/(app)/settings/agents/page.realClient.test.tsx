/**
 * /settings/agents — a preference write whose answer cannot be read, through
 * the REAL `HttpClient` and the real API module. Only the network is stubbed,
 * plus `sonner`, which is where the test reads the page's message.
 *
 * The PUT answers 2xx with a body that is not JSON (an intermediary's HTML
 * page), so the write may have landed and "failed" would be a claim nobody can
 * make. The page re-reads, and when that read lists no such agent it says so,
 * rather than reporting the parse error as a failed save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as object | null }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

import { HttpClient } from "@/services/http-client";
import AgentsSettingsPage from "./page";

function tokenManager(): TokenManager {
  return {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 3_600_000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  } as object as TokenManager;
}

function agent(name: string) {
  return {
    agent_name: name,
    purpose: "Reviews code changes.",
    spawn_path: "in_session_subagent",
    model: null,
    effort: null,
    policy_required: false,
    fanout_bound: 15,
    enabled: false,
    disposition: "degrade",
    source: "default",
  };
}

const network = { registryReads: 0, writes: 0 };

beforeEach(() => {
  network.registryReads = 0;
  network.writes = 0;
  toasts.error.mockReset();
  toasts.success.mockReset();
  toasts.warning.mockReset();
  for (const k of ["warn", "error", "log", "debug"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  holder.client = new HttpClient(tokenManager());
  // The page's first read lists code-reviewer; the re-read after the write
  // lists only another agent. The PUT answers 2xx with an HTML page.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && url.includes("/agent-registry/prefs/")) {
        network.writes += 1;
        return new Response("<html><body>Upstream says hello</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (method === "GET" && url.endsWith("/api/v1/agent-registry")) {
        network.registryReads += 1;
        const agents =
          network.registryReads === 1
            ? [agent("code-reviewer")]
            : [agent("merge-shepherd")];
        return new Response(JSON.stringify({ agents }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response('{"error":"not in this test"}', { status: 404 });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/settings/agents — an unreadable 2xx write, through the real client", () => {
  it("re-reads and says the read lists no such agent", async () => {
    render(<AgentsSettingsPage />);
    await userEvent.click(
      await screen.findByLabelText<HTMLInputElement>("Toggle code-reviewer")
    );

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(network.writes).toBe(1);
    expect(network.registryReads).toBe(2);
    const said = String(toasts.error.mock.calls[0]?.[0]);
    expect(said.startsWith("code-reviewer: ")).toBe(true);
    expect(said).toContain("A read made after it lists no such agent.");
    // Not the parse error of the HTML page, and not a confident outcome.
    expect(said).not.toMatch(/JSON|Unexpected token/);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.warning).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-pref-denied-not-authorized")).toBeNull();
  });
});
