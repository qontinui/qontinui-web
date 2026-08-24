/**
 * /settings/agents — the two 403 refusals render as distinct inline states.
 *
 * Phase 2 of plan
 * `2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui`.
 *
 * ## The defect these pin
 *
 * Every non-422 failure fell through to `toast.error(err.message)` carrying
 * coord's raw text. A 403 is not transient — a toast disappears and leaves a
 * switch that did not move with no standing explanation of why — and the two
 * 403s that reach this page need DIFFERENT answers:
 *
 * - a plain authorization denial → ask an administrator;
 * - `operator_not_provisioned_in_web` → an account-LINKING problem, which no
 *   permission grant fixes.
 *
 * Rendering them identically sends the reader to someone who cannot help.
 *
 * ## What "can go red" means here
 *
 * Each test asserts BOTH halves: the explanatory element is present AND
 * `toast.error` was not called. Deleting the 403 arm from `save()`'s catch
 * turns every one of them red on the first half; collapsing the two codes into
 * one state turns `distinguishes` red on the second.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listAgentRegistry = vi.fn();
const putAgentPref = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

// The real `AgentPrefError` is used unmocked — its `status`/`code` split is
// exactly what the page keys on, so stubbing it would test a different type
// than production constructs.
vi.mock("@/lib/api/agent-registry", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agent-registry")
  >("@/lib/api/agent-registry");
  return {
    ...actual,
    listAgentRegistry: (...args: unknown[]) => listAgentRegistry(...args),
    putAgentPref: (...args: unknown[]) => putAgentPref(...args),
  };
});

import { AgentPrefError } from "@/lib/api/agent-registry";
import AgentsSettingsPage from "./page";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    agent_name: "code-reviewer",
    purpose: "Reviews code changes.",
    spawn_path: "in_session_subagent",
    model: null,
    effort: null,
    policy_required: false,
    fanout_bound: 15,
    enabled: false,
    disposition: "degrade",
    source: "default",
    ...overrides,
  };
}

async function renderAndToggle() {
  render(<AgentsSettingsPage />);
  const toggle = await screen.findByLabelText("Toggle code-reviewer");
  await userEvent.click(toggle);
}

describe("/settings/agents — account-level refusals", () => {
  beforeEach(() => {
    listAgentRegistry.mockReset();
    putAgentPref.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    listAgentRegistry.mockResolvedValue([entry()]);
  });

  it("a plain 403 renders the permissions state, not a toast", async () => {
    putAgentPref.mockRejectedValue(
      new AgentPrefError("Forbidden", null, 403)
    );

    await renderAndToggle();

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-pref-denied-not-authorized")
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText("Your account cannot change this")
    ).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("operator_not_provisioned_in_web renders the account-linking state", async () => {
    putAgentPref.mockRejectedValue(
      new AgentPrefError(
        "operator_not_provisioned_in_web",
        "operator_not_provisioned_in_web",
        403
      )
    );

    await renderAndToggle();

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-pref-denied-not-provisioned")
      ).toBeInTheDocument()
    );
    // The remedy differs, and saying so is the whole point of the split.
    expect(
      screen.getByText(/account-linking problem, not a permissions one/i)
    ).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("distinguishes the two: neither state renders the other's element", async () => {
    putAgentPref.mockRejectedValue(
      new AgentPrefError(
        "operator_not_provisioned_in_web",
        "operator_not_provisioned_in_web",
        403
      )
    );

    await renderAndToggle();

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-pref-denied-not-provisioned")
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("agent-pref-denied-not-authorized")
    ).toBeNull();
  });

  it("the switch still shows the SERVER's state after a refusal", async () => {
    putAgentPref.mockRejectedValue(new AgentPrefError("Forbidden", null, 403));

    await renderAndToggle();

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-pref-denied-not-authorized")
      ).toBeInTheDocument()
    );
    // No optimism, so nothing to roll back: the control never left the truth.
    const toggle = screen.getByLabelText<HTMLInputElement>(
      "Toggle code-reviewer"
    );
    expect(toggle.checked).toBe(false);
  });

  it("a transport failure still toasts — the 403 arm must not swallow it", async () => {
    putAgentPref.mockRejectedValue(new Error("Failed to fetch"));

    await renderAndToggle();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(
      screen.queryByTestId("agent-pref-denied-not-authorized")
    ).toBeNull();
    expect(screen.queryByTestId("agent-pref-denied-not-provisioned")).toBeNull();
  });

  it("a later successful save clears the standing explanation", async () => {
    putAgentPref.mockRejectedValueOnce(
      new AgentPrefError("Forbidden", null, 403)
    );

    await renderAndToggle();
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-pref-denied-not-authorized")
      ).toBeInTheDocument()
    );

    putAgentPref.mockResolvedValueOnce(undefined);
    listAgentRegistry.mockResolvedValue([entry({ enabled: true })]);
    await userEvent.click(screen.getByLabelText("Toggle code-reviewer"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("agent-pref-denied-not-authorized")
      ).toBeNull()
    );
  });
});
