/**
 * The Scheduled tab of the Execute page: the runner's scheduled tasks are
 * listed from, and edited on, the READ target (where they live). A read that
 * did not answer is shown as a failure, never as "no scheduled tasks".
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";

const READ: RunnerTarget = {
  kind: "runner",
  runner: { id: "read-target" },
  locality: "local",
};

const state = vi.hoisted(() => ({
  query: {
    data: null as ScheduledTask[] | null,
    isLoading: false,
    error: null as string | null,
  },
  refetch: vi.fn(async () => {}),
  update: vi.fn(async (..._args: unknown[]) => ({})),
  remove: vi.fn(async (..._args: unknown[]) => {}),
  run: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => READ,
}));
vi.mock("@/lib/runner/hooks/scheduler-hooks", () => ({
  useScheduledTasks: () => ({ ...state.query, refetch: state.refetch }),
  updateScheduledTask: state.update,
  deleteScheduledTask: state.remove,
  runScheduledTaskNow: state.run,
}));
vi.mock("./ScheduleEditorDialog", () => ({
  ScheduleEditorDialog: ({
    open,
    editingTask,
  }: {
    open: boolean;
    editingTask?: ScheduledTask;
  }) =>
    open ? <div data-testid="editor">{editingTask?.id ?? "new"}</div> : null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ScheduledTasksPanel } from "./ScheduledTasksPanel";

const TASK = {
  id: "task-1",
  name: "Nightly",
  enabled: true,
  schedule: { type: "Cron", value: "0 9 * * *" },
  task: { task_type: "Workflow", workflow_name: "wf" },
  skipIfCompleted: false,
  autoFixOnFailure: false,
  createdAt: "2026-09-29T00:00:00Z",
  modifiedAt: "2026-09-29T00:00:00Z",
} as unknown as ScheduledTask;

beforeEach(() => {
  state.query = { data: null, isLoading: false, error: null };
  state.refetch.mockClear();
  state.update.mockClear();
  state.remove.mockClear();
  state.run.mockClear();
});

describe("ScheduledTasksPanel", () => {
  it("an unanswered read is a failure, not an empty list", () => {
    state.query = { data: null, isLoading: false, error: "runner offline" };
    render(<ScheduledTasksPanel />);
    expect(screen.getByText(/Could not load scheduled tasks/)).toBeTruthy();
    expect(screen.queryByText("No Scheduled Tasks")).toBeNull();
  });

  it("an answered empty list says there are none", () => {
    state.query = { data: [], isLoading: false, error: null };
    render(<ScheduledTasksPanel />);
    expect(screen.getByText("No Scheduled Tasks")).toBeTruthy();
  });

  it("run now, toggle and edit act on the READ target and refetch", async () => {
    state.query = { data: [TASK], isLoading: false, error: null };
    render(<ScheduledTasksPanel />);
    expect(screen.getByText("Nightly")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Run now"));
    await vi.waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
    expect(state.run).toHaveBeenCalledWith(READ, "task-1");

    fireEvent.click(screen.getByRole("switch"));
    await vi.waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(2));
    expect(state.update).toHaveBeenCalledWith(READ, "task-1", {
      enabled: false,
    });

    fireEvent.click(screen.getByTitle("Edit"));
    expect(screen.getByTestId("editor").textContent).toBe("task-1");
  });

  it("New Schedule opens the editor with no task", () => {
    state.query = { data: [], isLoading: false, error: null };
    render(<ScheduledTasksPanel />);
    fireEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByTestId("editor").textContent).toBe("new");
  });
});
