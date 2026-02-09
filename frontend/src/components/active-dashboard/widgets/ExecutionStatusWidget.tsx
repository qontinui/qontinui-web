"use client";

import type { TaskRun } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge } from "lucide-react";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatElapsed(startedAt: string): string {
  try {
    const start = new Date(startedAt).getTime();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    return formatDuration(elapsed);
  } catch {
    return "-";
  }
}

export function ExecutionStatusWidget({ run }: { run: TaskRun }) {
  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="size-4 text-cyan-400" />
          Execution Status
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Status</div>
            <Badge
              variant={
                run.status === "running"
                  ? "info"
                  : run.status === "completed"
                    ? "success"
                    : "destructive"
              }
              className="text-xs"
            >
              {run.status}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Phase</div>
            <Badge variant="outline" className="text-xs">
              {run.phase || "\u2014"}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Elapsed</div>
            <span className="text-sm font-medium text-text-primary">
              {formatElapsed(run.created_at)}
            </span>
          </div>
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Iterations</div>
            <span className="text-sm font-medium text-text-primary">
              {run.iteration_count ?? 0}
            </span>
          </div>
          {run.sessions_count != null && (
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Sessions</div>
              <span className="text-sm font-medium text-text-primary">
                {run.sessions_count}
                {run.max_sessions ? `/${run.max_sessions}` : ""}
              </span>
            </div>
          )}
          {run.workflow_name && (
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Workflow</div>
              <span className="text-xs text-text-secondary truncate">
                {run.workflow_name}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
