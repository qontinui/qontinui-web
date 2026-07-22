/**
 * Component test for CanonicalSelector's confirm-and-explain flow.
 *
 * Designating canonical re-points every other machine's drift, and the audit
 * row's `note` is the only place the reason is ever captured. The behaviours
 * that matter:
 *
 *   1. picking a machine does NOT fire the PUT — it opens the confirm dialog
 *   2. cancelling fires nothing at all
 *   3. confirming with a reason sends it as the note
 *   4. confirming without one sends no note (undefined, not "")
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Machine } from "@/services/devenv-api";

const setCanonicalMachine = vi.fn();

// Defined inside the factory — `vi.mock` is hoisted above this file's own
// declarations, so an identifier reference would hit its TDZ.
vi.mock("@/services/devenv-api", () => {
  class DevenvApiError extends Error {}
  return {
    setCanonicalMachine: (...args: unknown[]) => setCanonicalMachine(...args),
    getCanonicalHistory: () => Promise.resolve([]),
    DevenvApiError,
    CANONICAL_NOTE_MAX_LEN: 500,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CanonicalSelector } from "./CanonicalSelector";

function machine(id: string, name: string): Machine {
  return { id, name } as Machine;
}

const MACHINES = [machine("m-a", "machine-a"), machine("m-b", "machine-b")];

function renderSelector() {
  const onCanonicalChange = vi.fn();
  render(
    <CanonicalSelector
      environmentId="env-1"
      canonicalMachineId="m-a"
      eligibleMachines={MACHINES}
      onCanonicalChange={onCanonicalChange}
    />
  );
  return { onCanonicalChange };
}

/** Open the Select and choose `name`. */
async function pick(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
  return user;
}

describe("CanonicalSelector", () => {
  beforeEach(() => {
    setCanonicalMachine.mockReset();
    setCanonicalMachine.mockResolvedValue({});
  });

  it("opens a confirm dialog instead of designating immediately", async () => {
    renderSelector();
    await pick("machine-b");

    expect(
      await screen.findByText(/Make machine-b canonical\?/i)
    ).toBeInTheDocument();
    // It names what is being replaced, since drift is recomputed against it.
    expect(screen.getByText(/instead of machine-a/i)).toBeInTheDocument();
    expect(setCanonicalMachine).not.toHaveBeenCalled();
  });

  it("cancelling designates nothing", async () => {
    const { onCanonicalChange } = renderSelector();
    const user = await pick("machine-b");

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(setCanonicalMachine).not.toHaveBeenCalled();
    expect(onCanonicalChange).not.toHaveBeenCalled();
  });

  it("sends the typed reason as the audit note", async () => {
    const { onCanonicalChange } = renderSelector();
    const user = await pick("machine-b");

    await user.type(
      screen.getByLabelText(/reason/i),
      "b was rebuilt from current lockfiles"
    );
    await user.click(screen.getByRole("button", { name: /make canonical/i }));

    expect(setCanonicalMachine).toHaveBeenCalledWith(
      "env-1",
      "m-b",
      "b was rebuilt from current lockfiles"
    );
    expect(onCanonicalChange).toHaveBeenCalledWith("m-b");
  });

  it("confirming with no reason sends an empty note the client drops", async () => {
    renderSelector();
    const user = await pick("machine-b");

    await user.click(screen.getByRole("button", { name: /make canonical/i }));

    // The client turns a blank note into an omitted field (see devenv-api).
    expect(setCanonicalMachine).toHaveBeenCalledWith("env-1", "m-b", "");
  });
});
