/**
 * /admin/coord/agent-registry — a saved write whose re-read is a 403, through
 * the REAL `HttpClient` and the real API module (only the network is stubbed).
 *
 * The page's own read answering 403 means "this reader is not an admin" and
 * swaps in the administrator panel. A save's re-read answering 403 after the
 * PUT answered 2xx is a different fact: the write is saved, and only what is
 * shown may be out of date. So the page says "Saved", keeps the rows, and shows
 * neither the panel nor a failure to load or to save.
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

import { HttpClient } from "@/services/http-client";
import CoordAgentRegistryPage from "./page";

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

const ROW = {
  agent_name: "code-reviewer",
  purpose: "Reviews code changes.",
  trigger_condition: "before opening a PR",
  spawn_path: "in_session_subagent",
  model: null,
  effort: null,
  default_enabled: false,
  policy_required: false,
  allowed_dispositions: ["block", "degrade", "warn_proceed"],
  fanout_bound: 15,
  pref_count: 0,
  pref_differs_from_default_count: 0,
};

const network = { registryReads: 0, writes: 0 };

function json(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  network.registryReads = 0;
  network.writes = 0;
  for (const k of ["warn", "error", "log", "debug"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  holder.client = new HttpClient(tokenManager());
  // The registry read answers the page's first read with one row and every
  // later one (the save's re-read) with the web tier's admin-gate 403; the
  // tenant-default PUT answers 2xx.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && url.includes("/admin/registry/code-reviewer")) {
        network.writes += 1;
        return json({ ...ROW, default_enabled: true }, 200);
      }
      if (method === "GET" && url.endsWith("/admin/registry")) {
        network.registryReads += 1;
        return network.registryReads === 1
          ? json({ agents: [ROW] }, 200)
          : json({ detail: "not_coord_tenant_admin" }, 403);
      }
      return json({ error: "not in this test" }, 404);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/admin/coord/agent-registry — a 2xx save, through the real client", () => {
  it("says Saved when the PUT answers 2xx and its re-read answers 403", async () => {
    render(<CoordAgentRegistryPage />);
    const box = await screen.findByLabelText<HTMLInputElement>(
      "Default-enable code-reviewer"
    );
    await userEvent.click(box);

    await waitFor(() => expect(network.registryReads).toBe(2));
    const line = await screen.findByTestId(
      "agent-registry-save-error-code-reviewer"
    );
    expect(network.writes).toBe(1);
    const said = line.textContent ?? "";
    expect(said.startsWith("Saved, ")).toBe(true);
    expect(said.toLowerCase()).not.toContain("failed to");
    expect(said).not.toContain("not_coord_tenant_admin");
    // The page stays: no administrator panel, no load-failure banner.
    expect(screen.queryByTestId("coord-agent-registry-forbidden")).toBeNull();
    expect(screen.queryByTestId("coord-agent-registry-error")).toBeNull();
    expect(
      screen.queryByText("Failed to load the agent registry", { exact: false })
    ).toBeNull();
    expect(screen.getByTestId("coord-agent-registry-page")).toBeInTheDocument();
  });
});
