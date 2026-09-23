/**
 * Running the execute queue is NEW work (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3): it
 * goes only to the user's explicit choice or coord's `resolved` pick. When
 * coord named no runner the Run action is disabled and coord's outcome shown;
 * otherwise the composed run is sent to the dispatch target.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchRunnerTarget } from "@/contexts/active-runner-context";
import type { RunnerTarget } from "@/lib/runner/target";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WF = {
  id: "wf-1",
  name: "Nightly",
  description: "",
  category: "main",
  setup_steps: [],
  verification_steps: [],
  agentic_steps: [],
  completion_steps: [],
};

const state = vi.hoisted(() => ({
  dispatch: null as unknown as DispatchRunnerTarget,
  runTargets: [] as RunnerTarget[],
  runCalls: 0,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchRunnerTarget: () => state.dispatch,
}));
vi.mock("@/lib/runner-api", () => ({
  useRunnerTarget: () => ({ kind: "pending" }),
  runnerRequest: vi.fn(),
  createRunnerApi: (target: RunnerTarget) => {
    state.runTargets.push(target);
    return {
      runComposedWorkflow: async () => {
        state.runCalls += 1;
        return { task_run_id: "tr-1" };
      },
    };
  },
}));
vi.mock("@/lib/api/unified-workflows", () => ({
  useUnifiedWorkflows: () => ({
    data: [WF],
    isLoading: false,
    isOffline: false,
  }),
}));
vi.mock("@/hooks/usePageSpecs", () => ({ usePageSpecs: () => {} }));
vi.mock("@/lib/ui-bridge/use-discovered-specs", () => ({
  useDiscoveredSpec: () => null,
}));
vi.mock("@qontinui/ui-bridge", () => ({ useDropZone: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/execute/WorkflowLibraryPanel", () => ({
  WorkflowLibraryPanel: ({
    onAddWorkflow,
  }: {
    onAddWorkflow: (w: typeof WF) => void;
  }) => (
    <button data-testid="add" onClick={() => onAddWorkflow(WF)}>
      add
    </button>
  ),
}));
vi.mock("@/components/execute/SequenceBuilderPanel", () => ({
  SequenceBuilderPanel: ({
    items,
    onRun,
    runRefusal,
  }: {
    items: unknown[];
    onRun: () => void;
    runRefusal?: string | null;
  }) => (
    <div>
      <button
        data-testid="run"
        disabled={items.length === 0 || (runRefusal ?? null) !== null}
        onClick={onRun}
      >
        Run
      </button>
      {runRefusal && <p data-testid="run-refusal">{runRefusal}</p>}
    </div>
  ),
}));

import ExecutePage from "./page";

beforeEach(() => {
  state.runTargets = [];
  state.runCalls = 0;
});

describe("Execute page Run goes only where NEW work may go", () => {
  it("coord says all runners are drained: Run is disabled and the outcome is shown", () => {
    const message =
      "All your runners are drained — taken out of service for new work.";
    state.dispatch = {
      target: { kind: "unavailable", reason: "no_eligible_runner", message },
      runnerId: null,
      refusal: { reason: "all_drained", message },
    };
    render(<ExecutePage />);
    fireEvent.click(screen.getByTestId("add"));
    expect(screen.getByTestId("run")).toBeDisabled();
    expect(screen.getByTestId("run-refusal").textContent).toBe(message);
    fireEvent.click(screen.getByTestId("run"));
    expect(state.runCalls).toBe(0);
  });

  it("coord resolved a runner: the run is sent to the dispatch target", async () => {
    state.dispatch = {
      target: { kind: "runner", runner: { id: DESK }, locality: "unknown" },
      runnerId: DESK,
      refusal: null,
    };
    render(<ExecutePage />);
    fireEvent.click(screen.getByTestId("add"));
    expect(screen.getByTestId("run")).toBeEnabled();
    fireEvent.click(screen.getByTestId("run"));
    await vi.waitFor(() => expect(state.runCalls).toBe(1));
    expect(state.runTargets.at(-1)).toMatchObject({
      kind: "runner",
      runner: { id: DESK },
    });
  });
});
