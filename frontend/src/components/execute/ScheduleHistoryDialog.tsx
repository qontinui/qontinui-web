"use client";

import { History, Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTaskHistory } from "@/lib/runner/hooks/scheduler-hooks";
import type {
  ScheduledTask,
  TaskExecutionRecord,
} from "@/lib/runner/types/scheduler";

interface ScheduleHistoryDialogProps {
  /** The task whose runs are shown. Mount one dialog per task (keyed). */
  task: ScheduledTask;
  onClose: () => void;
}

const STATUS_CLASS: Record<string, string> = {
  completed: "text-green-400",
  running: "text-blue-400",
  failed: "text-red-400",
  launch_failed: "text-red-400",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function HistoryRow({ record }: { record: TaskExecutionRecord }) {
  return (
    <li className="py-2 border-b border-border-subtle/30 last:border-b-0">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span
          className={`font-medium ${STATUS_CLASS[record.status] ?? "text-text-muted"}`}
        >
          {record.status.replace(/_/g, " ")}
        </span>
        <span className="text-text-muted">{formatTime(record.startedAt)}</span>
      </div>
      {record.errorMessage && (
        <p className="mt-1 text-xs text-red-400/80 break-words">
          {record.errorMessage}
        </p>
      )}
      {record.triggeredAutoFix && (
        <p className="mt-1 text-[11px] text-text-muted">Auto-fix triggered</p>
      )}
    </li>
  );
}

/**
 * The runner's execution history for one scheduled task (its most recent 50
 * runs), read from the read target where the task lives.
 */
export function ScheduleHistoryDialog({
  task,
  onClose,
}: ScheduleHistoryDialogProps) {
  const { data: history, isLoading, error } = useTaskHistory(task.id);

  let body;
  if (isLoading && !history) {
    body = (
      <div className="flex justify-center py-8 text-text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  } else if (!history) {
    // An unanswered read is UNKNOWN, never "no runs yet".
    body = (
      <p className="py-6 text-center text-sm text-red-400">
        Could not load the run history{error ? `: ${error}` : "."}
      </p>
    );
  } else if (history.length === 0) {
    body = (
      <p className="py-6 text-center text-sm text-text-muted">
        This schedule has not run yet.
      </p>
    );
  } else {
    body = (
      <ul data-testid="schedule-history">
        {history.map((record) => (
          <HistoryRow key={record.executionId} record={record} />
        ))}
      </ul>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        role="button"
        tabIndex={0}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <Card className="relative z-10 w-full max-w-lg max-h-[80vh] overflow-y-auto bg-surface-raised border-border-subtle/50 shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-text-primary flex items-center gap-2">
            <History className="size-4" />
            Run history: {task.name}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            title="Close"
          >
            <X className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}
