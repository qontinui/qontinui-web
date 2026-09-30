"use client";

import { useState, type ReactNode } from "react";
import { Calendar, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRunnerTarget } from "@/contexts/active-runner-context";
import {
  useScheduledTasks,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
} from "@/lib/runner/hooks/scheduler-hooks";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";
import { ScheduleEditorDialog } from "./ScheduleEditorDialog";
import { ScheduleListItem } from "./ScheduleListItem";

/**
 * The runner's scheduled tasks: list, create, edit, delete, run now, and
 * enable/disable. Reads and edits go to the read target, where the tasks
 * live; creating a task is new work and is routed by `useScheduleForm`.
 */
export function ScheduledTasksPanel() {
  const target = useRunnerTarget();
  const { data: tasks, isLoading, error, refetch } = useScheduledTasks();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();

  const openEditor = (task?: ScheduledTask) => {
    setEditingTask(task);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditingTask(undefined);
  };

  const act = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${label}`);
    } finally {
      await refetch();
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
            onDelete={(t) =>
              act("delete the schedule", () =>
                deleteScheduledTask(target, t.id)
              )
            }
            onRunNow={(t) =>
              act("run the schedule", () => runScheduledTaskNow(target, t.id))
            }
            onToggleEnabled={(t, enabled) =>
              act("update the schedule", () =>
                updateScheduledTask(target, t.id, { enabled })
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
        </p>
        <Button variant="brand-primary" size="sm" onClick={() => openEditor()}>
          <Plus className="size-4" />
          New Schedule
        </Button>
      </div>

      {body}

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
