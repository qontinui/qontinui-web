/**
 * CREATING a scheduled task places new work on a runner (it will fire there),
 * so it goes only to the user's explicit choice or coord's `resolved` pick
 * (plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3).
 * Editing an EXISTING task stays on the read target, where the task lives.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DispatchRunnerTarget,
  DispatchTargetReason,
} from "@/contexts/active-runner-context";
import type { RunnerTarget } from "@/lib/runner/target";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const READ: RunnerTarget = {
  kind: "runner",
  runner: { id: "read-fallback" },
  locality: "local",
};

const state = vi.hoisted(() => ({
  dispatch: null as unknown as DispatchRunnerTarget,
  mutationTargets: [] as unknown[],
  mutate: vi.fn(async () => ({ id: "task-1" })),
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchRunnerTarget: () => state.dispatch,
  useRunnerTarget: () => READ,
}));
vi.mock("@/lib/runner/api-client", () => ({
  runnerFetch: vi.fn(),
  useRunnerQuery: () => ({ data: null, isLoading: false, error: null }),
  useRunnerMutation: (target: unknown, path: string) => {
    state.mutationTargets.push({ target, path });
    return { mutate: state.mutate, isLoading: false, error: null };
  },
}));
vi.mock("@/lib/api/unified-workflows", () => ({
  useUnifiedWorkflows: () => ({ data: [], isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useScheduleForm } from "./useScheduleForm";

function fill(form: ReturnType<typeof useScheduleForm>) {
  act(() => {
    form.setName("Nightly");
    form.setWorkflowName("wf");
  });
}

beforeEach(() => {
  state.mutationTargets = [];
  state.mutate.mockClear();
});

describe("creating a schedule goes only where NEW work may go", () => {
  it.each([
    [
      "all_drained",
      "All your runners are drained — taken out of service for new work.",
    ],
    ["resolver_unavailable", "Which runner should take new work is unknown."],
  ])(
    "refused (%s): the create is not sent, and coord's outcome is the refusal",
    async (reason, message) => {
      state.dispatch = {
        target: {
          kind: "unavailable",
          reason: "resolver_unavailable",
          message,
        },
        runnerId: null,
        refusal: {
          reason: reason as DispatchTargetReason,
          message,
        },
      };
      const { result } = renderHook(() =>
        useScheduleForm(true, undefined, () => {})
      );
      fill(result.current);
      expect(result.current.saveRefusal).toBe(message);
      await act(async () => {
        await result.current.handleSave();
      });
      expect(state.mutate).not.toHaveBeenCalled();
    }
  );

  it("allowed (resolved): the create goes to the DISPATCH target, not the read target", async () => {
    const target: RunnerTarget = {
      kind: "runner",
      runner: { id: DESK },
      locality: "unknown",
    };
    state.dispatch = { target, runnerId: DESK, refusal: null };
    const { result } = renderHook(() =>
      useScheduleForm(true, undefined, () => {})
    );
    fill(result.current);
    expect(result.current.saveRefusal).toBeNull();
    await act(async () => {
      await result.current.handleSave();
    });
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutationTargets.at(-1)).toEqual({
      target,
      path: "/scheduler/tasks",
    });
  });
});
