/**
 * /settings/agents — an agent the tenant admin switched off renders LOCKED.
 *
 * Phase 7 of plan
 * `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type`. Coord
 * folds the admin ceiling as `enabled: false, source: "admin"`, and a member's
 * pref write there is accepted but can never widen it. A toggle on that row
 * would be a control that does nothing, so there must be none.
 *
 * Goes red if the lock is dropped (the toggle reappears and a click writes a
 * pref), or if the row stops saying who turned it off.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const listAgentRegistry = vi.fn();
const putAgentPref = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api/agent-registry", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agent-registry")
  >("@/lib/api/agent-registry");
  return {
    ...actual,
    listAgentRegistry: (...a: unknown[]) => listAgentRegistry(...a),
    putAgentPref: (...a: unknown[]) => putAgentPref(...a),
  };
});

import AgentsSettingsPage from "./page";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    agent_name: "code-reviewer",
    purpose: "Reviews code changes.",
    spawn_path: "in_session_subagent",
    model: null,
    effort: null,
    policy_required: true,
    fanout_bound: 15,
    enabled: true,
    disposition: "degrade",
    source: "default",
    ...overrides,
  };
}

beforeEach(() => {
  listAgentRegistry.mockReset();
  putAgentPref.mockReset();
});

describe("/settings/agents — the tenant-admin ceiling", () => {
  it("renders an admin-disabled agent locked, with no toggle", async () => {
    listAgentRegistry.mockResolvedValue([
      entry({ enabled: false, disposition: "block", source: "admin" }),
    ]);
    render(<AgentsSettingsPage />);

    const card = await screen.findByTestId("agent-pref-row-code-reviewer");
    expect(card).toHaveAttribute("data-locked", "true");
    expect(
      within(card).getByTestId("agent-pref-locked-code-reviewer")
    ).toHaveTextContent("Turned off by your tenant admin");
    expect(within(card).queryByLabelText("Toggle code-reviewer")).toBeNull();
    expect(within(card).queryByRole("checkbox")).toBeNull();
    expect(card).toHaveTextContent(
      "Your own preference cannot turn it back on."
    );
    expect(card).toHaveTextContent("disposition: Block");
    expect(
      within(card).getByRole("link", { name: "the tenant's agent registry" })
    ).toHaveAttribute("href", "/admin/coord/agent-registry");
    expect(putAgentPref).not.toHaveBeenCalled();
  });

  it("keeps the toggle on an agent the member disabled themselves", async () => {
    listAgentRegistry.mockResolvedValue([
      entry({ enabled: false, source: "user_pref" }),
    ]);
    render(<AgentsSettingsPage />);

    const card = await screen.findByTestId("agent-pref-row-code-reviewer");
    expect(card).toHaveAttribute("data-locked", "false");
    expect(
      within(card).getByLabelText("Toggle code-reviewer")
    ).toBeInTheDocument();
    expect(
      within(card).queryByTestId("agent-pref-locked-code-reviewer")
    ).toBeNull();
  });
});
