"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Play,
  Pencil,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";
import { describeSchedule } from "@qontinui/workflow-utils";

// =============================================================================
// Props
// =============================================================================

interface ScheduleListItemProps {
  task: ScheduledTask;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onRunNow: (task: ScheduledTask) => void;
  onToggleEnabled: (task: ScheduledTask, enabled: boolean) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const absDiff = Math.abs(diff);
  const isFuture = diff < 0;

  if (absDiff < 60_000) return isFuture ? "in <1m" : "<1m ago";
  if (absDiff < 3_600_000) {
    const mins = Math.round(absDiff / 60_000);
    return isFuture ? `in ${mins}m` : `${mins}m ago`;
  }
  if (absDiff < 86_400_000) {
    const hours = Math.round(absDiff / 3_600_000);
    return isFuture ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(absDiff / 86_400_000);
  return isFuture ? `in ${days}d` : `${days}d ago`;
}

function getLastRunBadge(task: ScheduledTask) {
  if (!task.last_run) return null;

  const record = task.last_run;
  const time = record.ended_at || record.started_at;

  switch (record.status) {
    case "Running":
      return (
        <Badge
          variant="outline"
          className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]"
        >
          <Loader2 className="size-2.5 animate-spin mr-1" />
          Running
        </Badge>
      );
    case "Completed":
      return (
        <Badge
          variant="outline"
          className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]"
        >
          <CheckCircle2 className="size-2.5 mr-1" />
          Passed {relativeTime(time)}
        </Badge>
      );
    case "Failed":
      return (
        <Badge
          variant="outline"
          className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]"
        >
          <XCircle className="size-2.5 mr-1" />
          Failed {relativeTime(time)}
        </Badge>
      );
    case "Skipped":
      return (
        <Badge
          variant="outline"
          className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-[10px]"
        >
          Skipped {relativeTime(time)}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-text-muted text-[10px]">
          {record.status} {relativeTime(time)}
        </Badge>
      );
  }
}

// =============================================================================
// Component
// =============================================================================

export function ScheduleListItem({
  task,
  onEdit,
  onDelete,
  onRunNow,
  onToggleEnabled,
}: ScheduleListItemProps) {
  const isWaitingOnConditions =
    task.condition_status && !task.condition_status.timed_out;

  return (
    <Card
      className={`border-border-subtle/50 hover:border-brand-primary/30 transition-all ${
        task.enabled
          ? "bg-surface-raised/50"
          : "bg-surface-raised/25 opacity-70"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {/* Enable/Disable toggle */}
          <Switch
            checked={task.enabled}
            onCheckedChange={(checked) => onToggleEnabled(task, checked)}
            className="shrink-0"
          />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-medium text-text-primary truncate text-sm">
                {task.name}
              </h3>
              {getLastRunBadge(task)}
              {isWaitingOnConditions && (
                <Badge
                  variant="outline"
                  className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-[10px]"
                >
                  <AlertCircle className="size-2.5 mr-1" />
                  Waiting
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {describeSchedule(task.schedule)}
              </span>
              {task.enabled && task.next_run && (
                <span className="text-text-muted/70">
                  Next: {relativeTime(task.next_run)}
                </span>
              )}
            </div>
            {task.description && (
              <p className="text-xs text-text-muted/60 mt-1 line-clamp-1">
                {task.description}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-green-400 hover:text-green-300"
              onClick={() => onRunNow(task)}
              title="Run now"
            >
              <Play className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-text-muted hover:text-text-secondary"
              onClick={() => onEdit(task)}
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-400 hover:text-red-300"
              onClick={() => onDelete(task)}
              title="Delete"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
