/**
 * /settings/agents — what a save says about its RE-READ, apart from the write.
 *
 * 1. **A PUT coord answered 2xx is saved.** The re-read after it has its own
 *    failure, which is about what is shown: it must not turn into "whether this
 *    change was saved is unknown", and a 403 on it is not an account denial of
 *    a write that succeeded.
 * 2. **An older re-read never paints over a newer one.** Two saves whose
 *    re-reads overtake each other leave the newer read on screen.
 * 3. **The open-outcome arm's two read-dependent lines**: it closes the picker
 *    once a read has answered, and says so when that read lists no such agent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listAgentRegistry = vi.fn();
const putAgentPref = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

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

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function toggleOf(name: string) {
  return screen.getByLabelText<HTMLInputElement>(`Toggle ${name}`);
}

beforeEach(() => {
  listAgentRegistry.mockReset();
  putAgentPref.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  listAgentRegistry.mockResolvedValue([entry()]);
});

describe("/settings/agents — a saved write and its re-read", () => {
  it.each([
    ["a 503", new AgentPrefError("busy", null, 503)],
    ["a 403", new AgentPrefError("Forbidden", null, 403)],
  ])(
    "a 2xx whose re-read fails with %s says saved, never unknown or denied",
    async (_label, readError) => {
      putAgentPref.mockResolvedValue(undefined);
      render(<AgentsSettingsPage />);
      await screen.findByLabelText("Toggle code-reviewer");
      listAgentRegistry.mockRejectedValue(readError);
      await userEvent.click(toggleOf("code-reviewer"));

      await waitFor(() => expect(toastWarning).toHaveBeenCalled());
      const said = String(toastWarning.mock.calls[0]?.[0]);
      expect(said).toContain("code-reviewer: saved, but the re-read failed");
      expect(said).toContain("so what is shown may be out of date");
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
      // One read after the write: no second, needless one.
      expect(listAgentRegistry).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByTestId("agent-pref-denied-not-authorized")
      ).toBeNull();
      expect(
        screen.queryByTestId("agent-pref-denied-not-provisioned")
      ).toBeNull();
    }
  );

  it("keeps the newer re-read when an older one lands after it", async () => {
    listAgentRegistry.mockResolvedValue([
      entry({ agent_name: "alpha" }),
      entry({ agent_name: "beta" }),
    ]);
    putAgentPref.mockResolvedValue(undefined);
    render(<AgentsSettingsPage />);
    await screen.findByLabelText("Toggle alpha");

    // Alpha's re-read is held; it read the registry before beta's write.
    const alphaRead = deferred<unknown>();
    listAgentRegistry.mockImplementationOnce(() => alphaRead.promise);
    await userEvent.click(toggleOf("alpha"));

    // Beta saves and its re-read answers first: alpha and beta both on.
    listAgentRegistry.mockResolvedValueOnce([
      entry({ agent_name: "alpha", enabled: true, source: "user_pref" }),
      entry({ agent_name: "beta", enabled: true, source: "user_pref" }),
    ]);
    await userEvent.click(toggleOf("beta"));
    await waitFor(() => expect(toggleOf("beta").checked).toBe(true));

    // Alpha's older read arrives, from before beta's write.
    await act(async () => {
      alphaRead.resolve([
        entry({ agent_name: "alpha", enabled: true, source: "user_pref" }),
        entry({ agent_name: "beta" }),
      ]);
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
    expect(toggleOf("beta").checked).toBe(true);
    expect(toggleOf("alpha").checked).toBe(true);
  });
});

describe("/settings/agents — the open-outcome arm's re-read", () => {
  it("closes the picker once the re-read has answered", async () => {
    listAgentRegistry.mockResolvedValue([
      entry({ enabled: true, policy_required: true }),
    ]);
    putAgentPref.mockRejectedValue(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    render(<AgentsSettingsPage />);
    await userEvent.click(await screen.findByLabelText("Toggle code-reviewer"));
    await userEvent.click(screen.getByLabelText(/Degrade to inline/));
    await userEvent.click(
      screen.getByRole("button", { name: /Disable agent/ })
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]?.[0])).toContain(
      "A read made after it says"
    );
    expect(screen.queryByRole("button", { name: /Disable agent/ })).toBeNull();
  });

  it("says the re-read lists no such agent when it does not", async () => {
    putAgentPref.mockRejectedValue(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    render(<AgentsSettingsPage />);
    await screen.findByLabelText("Toggle code-reviewer");
    listAgentRegistry.mockResolvedValue([entry({ agent_name: "other" })]);
    await userEvent.click(toggleOf("code-reviewer"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]?.[0])).toContain(
      "A read made after it lists no such agent."
    );
    // The list shown is that read's.
    expect(
      within(document.body).queryByLabelText("Toggle code-reviewer")
    ).toBeNull();
  });
});
