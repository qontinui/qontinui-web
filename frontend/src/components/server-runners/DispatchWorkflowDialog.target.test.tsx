/**
 * The dispatch dialog pre-selects ONLY where new work may go (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3): the
 * user's explicit choice or coord's `resolved` pick. The READ target's
 * fallbacks — a last known, proven-local or sole runner kept alive through an
 * outage or a "nothing eligible" answer — may be drained, and
 * `POST /devices/{id}/dispatch` checks neither drain nor capabilities, so
 * they are never pre-selected; coord's outcome is shown instead.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchTarget } from "@/contexts/active-runner-context";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  dispatch: null as unknown as DispatchTarget,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchTarget: () => state.dispatch,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useServerRunners", () => ({
  useRunners: () => ({
    data: [
      {
        id: DESK,
        name: "Desk runner",
        hostname: "desk",
        port: 9876,
        derivedStatus: "healthy",
      },
    ],
    isLoading: false,
  }),
  useDispatchWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  DispatchError: class extends Error {},
}));

import { DispatchWorkflowDialog } from "./DispatchWorkflowDialog";

function renderDialog() {
  return render(
    <DispatchWorkflowDialog
      open
      onOpenChange={() => {}}
      workflowId="wf-1"
      workflowName="Nightly"
    />
  );
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /dispatch/i }) as HTMLButtonElement;
}

beforeEach(() => {
  state.dispatch = { runnerId: null, reason: "resolving", message: null };
});

describe("DispatchWorkflowDialog pre-selection", () => {
  it.each([
    [
      "all_drained",
      "All your runners are drained — taken out of service for new work.",
    ],
    ["resolver_unavailable", "Which runner should take new work is unknown"],
    ["no_capable", "None of your runners is online and able to take new work."],
    ["drain_unreadable", "Coord could not read which runners are drained"],
  ] as const)(
    "%s: nothing is pre-selected and coord's outcome is shown",
    (reason, message) => {
      state.dispatch = { runnerId: null, reason, message };
      renderDialog();
      expect(submitButton()).toBeDisabled();
      expect(
        screen.getByTestId("dispatch-target-outcome").textContent
      ).toContain(message);
    }
  );

  it.each(["resolved", "explicit"] as const)(
    "%s: the runner is pre-selected",
    (reason) => {
      state.dispatch = { runnerId: DESK, reason, message: null };
      renderDialog();
      expect(submitButton()).toBeEnabled();
      expect(screen.queryByTestId("dispatch-target-outcome")).toBeNull();
    }
  );
});
