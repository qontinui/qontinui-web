"use client";

import { useState, useEffect } from "react";
import type { TaskRun } from "@/lib/runner-api";
import {
  useSharedStepsData,
  useSharedOrchestratorState,
} from "@/contexts/SharedRunnerDataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Gauge,
  Clock,
  Layers,
  Workflow,
  Activity,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Live elapsed timer
// ---------------------------------------------------------------------------

function LiveElapsed({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => {
    try {
      return Math.max(
        0,
        Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      );
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        setElapsed(
          Math.max(
            0,
            Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
          )
        );
      } catch {
        // ignore
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  return (
    <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
      {hours > 0 && `${hours}:`}
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Widget
// ---------------------------------------------------------------------------

export function ExecutionStatusWidget({ run }: { run: TaskRun }) {
  const { data: stepsData } = useSharedStepsData();
  const { data: orchState } = useSharedOrchestratorState();

  const executions = stepsData?.executions || [];
  const totalSteps = executions.length;
  const completedSteps = executions.filter(
    (e) => e.status === "success" || e.status === "failed"
  ).length;
  const runningStep = executions.find((e) => e.status === "running");
  const failedSteps = executions.filter((e) => e.status === "failed").length;

  const iterationCount = run.iteration_count ?? 0;
  const sessionCount = run.sessions_count ?? iterationCount;
  const maxSessions = run.max_sessions;

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="size-4 text-cyan-400" />
          Execution Status
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4 space-y-4">
        {/* Live timer */}
        <div className="flex items-center gap-3">
          <Clock className="size-4 text-text-muted" />
          <LiveElapsed startedAt={run.created_at} />
        </div>

        {/* Current step */}
        {runningStep && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="flex items-center gap-2 text-xs text-blue-400 mb-1">
              <Loader2 className="size-3 animate-spin" />
              <span className="font-medium">Current Step</span>
            </div>
            <p className="text-sm text-text-primary truncate">
              {runningStep.step_name}
            </p>
            <p className="text-[10px] text-text-muted mt-0.5 capitalize">
              {runningStep.step_type}
            </p>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Phase</div>
            <Badge
              variant="outline"
              className={cn(
                "text-xs capitalize",
                run.phase === "agentic" &&
                  "text-violet-400 border-violet-500/30",
                run.phase === "verification" &&
                  "text-teal-400 border-teal-500/30",
                run.phase === "setup" && "text-blue-400 border-blue-500/30",
                run.phase === "completion" &&
                  "text-green-400 border-green-500/30"
              )}
            >
              {run.phase || "\u2014"}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Iteration</div>
            <div className="flex items-center gap-1.5">
              <Layers className="size-3 text-text-muted" />
              <span className="text-sm font-medium text-text-primary">
                {iterationCount}
                {maxSessions != null && (
                  <span className="text-text-muted">/{maxSessions}</span>
                )}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Steps</div>
            <span className="text-sm font-medium text-text-primary">
              {completedSteps}/{totalSteps}
              {failedSteps > 0 && (
                <span className="text-red-400 ml-1">
                  ({failedSteps} failed)
                </span>
              )}
            </span>
          </div>
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Sessions</div>
            <span className="text-sm font-medium text-text-primary">
              {sessionCount > 0
                ? sessionCount
                : iterationCount > 0
                  ? iterationCount
                  : 1}
              {maxSessions != null && (
                <span className="text-text-muted">/{maxSessions}</span>
              )}
            </span>
          </div>
        </div>

        {/* Orchestrator info */}
        {orchState?.active_agent && (
          <div className="flex items-center gap-2">
            <Workflow className="size-3.5 text-violet-400" />
            <span className="text-xs text-text-muted">Agent:</span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {orchState.active_agent}
            </Badge>
          </div>
        )}

        {orchState?.current_action && (
          <div className="flex items-center gap-2">
            <Activity className="size-3.5 text-green-400" />
            <span className="text-xs text-text-muted truncate">
              {orchState.current_action}
            </span>
          </div>
        )}

        {/* Workflow info */}
        {run.workflow_name && (
          <div className="pt-2 border-t border-border-subtle/30">
            <div className="text-[10px] text-text-muted mb-0.5">Workflow</div>
            <span className="text-xs text-text-secondary">
              {run.workflow_name}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
