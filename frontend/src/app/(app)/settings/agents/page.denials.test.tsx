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
    putAgentPref.mockRejectedValue(new AgentPrefError("Forbidden", null, 403));

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
    expect(screen.queryByTestId("agent-pref-denied-not-authorized")).toBeNull();
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
    expect(screen.queryByTestId("agent-pref-denied-not-authorized")).toBeNull();
    expect(
      screen.queryByTestId("agent-pref-denied-not-provisioned")
    ).toBeNull();
  });

  it.each([
    [504, "timeout waiting for coord"],
    [500, "boom"],
    [502, "Bad Gateway"],
  ])(
    "a %i leaves the outcome unknown: it re-reads, says so and shows the read",
    async (status, detail) => {
      putAgentPref.mockRejectedValue(new AgentPrefError(detail, null, status));
      render(<AgentsSettingsPage />);
      const toggle = await screen.findByLabelText<HTMLInputElement>(
        "Toggle code-reviewer"
      );
      expect(toggle.checked).toBe(false);
      // The preference landed, though its answer was lost.
      listAgentRegistry.mockResolvedValue([
        entry({ enabled: true, source: "user_pref" }),
      ]);
      await userEvent.click(toggle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(listAgentRegistry).toHaveBeenCalledTimes(2);
      const said = toastError.mock.calls[0]?.[0];
      expect(said).toContain(
        `code-reviewer: whether this change was saved is unknown (${detail}).`
      );
      expect(said).toContain("A read made after it says: Recorded preference");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(
        screen.getByLabelText<HTMLInputElement>("Toggle code-reviewer").checked
      ).toBe(true);
    }
  );

  it.each([
    [
      "the client's timeout",
      new Error(
        "Request timeout - backend may be starting up. Please try again."
      ),
      "no answer came back within the client's time limit",
    ],
    [
      "a 5xx with no readable body",
      new AgentPrefError("Failed to save agent preference", null, 500, false),
      "HTTP 500 with no readable reason",
    ],
  ])(
    "an open outcome from %s neither invites a retry nor says failed",
    async (_label, error, reason) => {
      putAgentPref.mockRejectedValue(error);
      await renderAndToggle();
      await waitFor(() => expect(toastError).toHaveBeenCalled());
      const said = String(toastError.mock.calls[0]?.[0]);
      expect(said).toContain(
        `code-reviewer: whether this change was saved is unknown (${reason}).`
      );
      expect(said).not.toMatch(/fail|try again/i);
    }
  );

  it("says what is shown may be out of date when that re-read fails too", async () => {
    putAgentPref.mockRejectedValue(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    render(<AgentsSettingsPage />);
    const toggle = await screen.findByLabelText("Toggle code-reviewer");
    listAgentRegistry.mockRejectedValue(new Error("Failed to fetch"));
    await userEvent.click(toggle);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[0]).toContain(
      "The re-read failed too, so what is shown may be out of date."
    );
  });

  it.each([
    [400, "bad request"],
    [502, "coord is not reachable"],
    [
      502,
      "coord does not serve PUT /coord/agent-registry/prefs/code-reviewer yet — deploy qontinui-coord first",
    ],
  ])(
    "a %i (%s) stays a plain failure, with nothing re-read",
    async (status, detail) => {
      putAgentPref.mockRejectedValue(new AgentPrefError(detail, null, status));
      await renderAndToggle();

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(detail));
      expect(listAgentRegistry).toHaveBeenCalledTimes(1);
    }
  );

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
