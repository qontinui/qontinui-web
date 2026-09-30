"use client";

import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Calendar, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRunnerTarget } from "@/contexts/active-runner-context";
import {
  useScheduledTasks,
  useSchedulerStatus,
  setSchedulerEnabled,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
} from "@/lib/runner/hooks/scheduler-hooks";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";
import { ScheduleEditorDialog } from "./ScheduleEditorDialog";
import { ScheduleHistoryDialog } from "./ScheduleHistoryDialog";
import { ScheduleListItem } from "./ScheduleListItem";

/**
 * The runner's scheduled tasks: list, create, edit, delete, run now,
 * enable/disable and run history, plus the runner-wide scheduler switch.
 * Reads and edits go to the read target, where the tasks live; creating a
 * task is new work and is routed by `useScheduleForm`.
 */
export function ScheduledTasksPanel() {
  const target = useRunnerTarget();
  const { data: tasks, isLoading, error, refetch } = useScheduledTasks();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null);
  const { data: status, refetch: refetchStatus } = useSchedulerStatus();
  const [enablingScheduler, setEnablingScheduler] = useState(false);

  const enableScheduler = async () => {
    if (enablingScheduler) return;
    setEnablingScheduler(true);
    try {
      await setSchedulerEnabled(target, true);
      toast.success("Scheduler turned on");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to turn the scheduler on"
      );
    } finally {
      try {
        await Promise.all([refetchStatus(), refetch()]);
      } finally {
        setEnablingScheduler(false);
      }
    }
  };

  const openEditor = (task?: ScheduledTask) => {
    setEditingTask(task);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditingTask(undefined);
  };

  // One action per task at a time: a double click must not delete twice or
  // flip a toggle back.
  const inFlight = useRef(new Set<string>());
  const act = async (
    taskId: string,
    labels: { done: string; failed: string },
    action: () => Promise<unknown>
  ) => {
    if (inFlight.current.has(taskId)) return;
    inFlight.current.add(taskId);
    try {
      await action();
      toast.success(labels.done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : labels.failed);
    } finally {
      // Released only once the list reflects the action, so a deleted row
      // still on screen cannot be deleted again.
      try {
        await refetch();
      } finally {
        inFlight.current.delete(taskId);
      }
    }
  };

  let body: ReactNode;
  if (isLoading && !tasks) {
    body = (
      <div className="flex justify-center py-12 text-text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  } else if (!tasks) {
    // An unanswered read is UNKNOWN, never "no scheduled tasks".
    body = (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="py-8 text-center text-sm text-red-400">
          Could not load scheduled tasks{error ? `: ${error}` : "."}
        </CardContent>
      </Card>
    );
  } else if (tasks.length === 0) {
    body = (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="py-12 text-center">
          <Calendar className="w-12 h-12 mx-auto mb-3 text-text-muted" />
          <h3 className="text-lg font-medium text-text-secondary mb-1">
            No Scheduled Tasks
          </h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Create a schedule to run workflows automatically at specific times
            or intervals.
          </p>
        </CardContent>
      </Card>
    );
  } else {
    body = (
      <div className="space-y-2">
        {tasks.map((task) => (
          <ScheduleListItem
            key={task.id}
            task={task}
            onEdit={openEditor}
            onShowHistory={setHistoryTask}
            onDelete={(t) =>
              act(
                t.id,
                {
                  done: "Schedule deleted",
                  failed: "Failed to delete the schedule",
                },
                () => deleteScheduledTask(target, t.id)
              )
            }
            onRunNow={(t) =>
              act(
                t.id,
                { done: "Run started", failed: "Failed to run the schedule" },
                () => runScheduledTaskNow(target, t.id)
              )
            }
            onToggleEnabled={(t, enabled) =>
              act(
                t.id,
                {
                  done: enabled ? "Schedule enabled" : "Schedule disabled",
                  failed: "Failed to update the schedule",
                },
                () => updateScheduledTask(target, t.id, { enabled })
              )
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0" data-testid="scheduled-tasks-panel">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {tasks
            ? `${tasks.length} scheduled task${tasks.length !== 1 ? "s" : ""}`
            : "Scheduled tasks"}
          {target.kind === "runner" &&
            ` on ${target.runner.name ?? target.runner.id}`}
        </p>
        <Button variant="brand-primary" size="sm" onClick={() => openEditor()}>
          <Plus className="size-4" />
          New Schedule
        </Button>
      </div>

      {/* Only an answered status says the scheduler is off; an unanswered
          one shows nothing rather than guessing either way. */}
      {status?.enabled === false && (
        <div
          className="mb-4 flex items-center gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300"
          data-testid="scheduler-disabled"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">
            The scheduler is off on this runner, so no schedule will run until
            it is turned on.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={enableScheduler}
            disabled={enablingScheduler}
          >
            Turn on
          </Button>
        </div>
      )}

      {body}

      <ScheduleHistoryDialog
        task={historyTask}
        onClose={() => setHistoryTask(null)}
      />

      <ScheduleEditorDialog
        open={editorOpen}
        onClose={closeEditor}
        editingTask={editingTask}
        onSaved={() => {
          void refetch();
          closeEditor();
        }}
      />
    </div>
  );
}
