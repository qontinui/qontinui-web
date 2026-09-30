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
// The real button refuses programmatic clicks by design.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

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
  state.remove.mockReset();
  state.remove.mockImplementation(async () => {});
  toast.success.mockClear();
  toast.error.mockClear();
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

  it("delete goes to the READ target; a failure is toasted and the list still refetched", async () => {
    state.query = { data: [TASK], isLoading: false, error: null };
    state.remove.mockRejectedValueOnce(new Error("runner said no"));
    render(<ScheduledTasksPanel />);
    fireEvent.click(screen.getByTitle("Delete"));
    await vi.waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
    expect(state.remove).toHaveBeenCalledWith(READ, "task-1");
    expect(toast.error).toHaveBeenCalledWith("runner said no");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a second click while an action is in flight is ignored", async () => {
    state.query = { data: [TASK], isLoading: false, error: null };
    let release: () => void = () => {};
    state.run.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    render(<ScheduledTasksPanel />);
    fireEvent.click(screen.getByTitle("Run now"));
    fireEvent.click(screen.getByTitle("Run now"));
    release();
    await vi.waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
    expect(state.run).toHaveBeenCalledTimes(1);
  });

  it("names the runner whose schedules are listed", () => {
    state.query = { data: [], isLoading: false, error: null };
    render(<ScheduledTasksPanel />);
    expect(screen.getByText(/0 scheduled tasks on read-target/)).toBeTruthy();
  });

  it("loading shows a spinner, not the empty state or a failure", () => {
    state.query = { data: null, isLoading: true, error: null };
    render(<ScheduledTasksPanel />);
    expect(screen.queryByText("No Scheduled Tasks")).toBeNull();
    expect(screen.queryByText(/Could not load/)).toBeNull();
  });
});
