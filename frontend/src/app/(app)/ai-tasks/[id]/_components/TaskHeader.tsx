import { format } from "date-fns";
import { StatusIcon, StatusBadge } from "./StatusIndicators";
import { formatDuration } from "./utils";
import type { TaskRunBackendDetail } from "@/types/task-runs";

interface TaskHeaderProps {
  task: TaskRunBackendDetail;
}

export function TaskHeader({ task }: TaskHeaderProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-px bg-border">
      <div className="bg-background px-6 py-4">
        <div className="flex items-center gap-3 mb-2">
          <StatusIcon status={task.status} />
          <h2 className="text-base font-semibold">{task.task_name}</h2>
          <StatusBadge status={task.status} />
        </div>
        {task.prompt && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
            {task.prompt}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Created: {format(new Date(task.created_at), "MMM dd, yyyy HH:mm")}
          </span>
          {task.completed_at && (
            <span>
              Completed:{" "}
              {format(new Date(task.completed_at), "MMM dd, yyyy HH:mm")}
            </span>
          )}
          <span>Duration: {formatDuration(task.duration_seconds)}</span>
        </div>
      </div>
      <div className="bg-background px-6 py-4 flex items-center gap-6">
        <div className="text-center">
          <div className="text-xl font-bold text-primary">
            {task.sessions?.length || 0}
          </div>
          <div className="text-xs text-muted-foreground">Sessions</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-primary">
            {task.findings?.length || 0}
          </div>
          <div className="text-xs text-muted-foreground">Findings</div>
        </div>
      </div>
    </div>
  );
}
