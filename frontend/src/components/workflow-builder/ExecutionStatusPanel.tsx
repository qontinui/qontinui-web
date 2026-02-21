"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { RUNNER_API_BASE } from "@/lib/runner-api";
import {
  Activity,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Pause,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const POLL_INTERVAL_MS = 3000;
const TIMER_INTERVAL_MS = 1000;

// Phase colors matching the workflow builder
const PHASE_COLORS: Record<string, string> = {
  setup: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  verification: "text-green-400 bg-green-500/10 border-green-500/30",
  agentic: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  completion: "text-purple-400 bg-purple-500/10 border-purple-500/30",
};

interface WorkflowState {
  task_run_id: string;
  current_state: string;
  phase?: string;
  iteration?: number;
  max_iterations?: number;
  is_complete: boolean;
  is_stopped: boolean;
  workflow_start_time: string;
  workflow_stage?: string;
  workflow_stage_display: string;
}

interface TaskRun {
  id: string;
  workflow_id?: string;
  status: string;
  prompt?: string;
  started_at?: string;
}

interface ExecutionStatusPanelProps {
  workflowId: string;
}

export function ExecutionStatusPanel({
  workflowId,
}: ExecutionStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [taskRun, setTaskRun] = useState<TaskRun | null>(null);
  const taskRunRef = useRef<TaskRun | null>(null);
  const [workflowState, setWorkflowState] = useState<WorkflowState | null>(
    null
  );
  const [isPolling, setIsPolling] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const findRunningTask = useCallback(async () => {
    try {
      const res = await fetch(`${RUNNER_API_BASE}/task-runs/running`);
      if (!res.ok) return null;
      const tasks: TaskRun[] = await res.json();
      return tasks.find((t) => t.workflow_id === workflowId) ?? null;
    } catch {
      return null;
    }
  }, [workflowId]);

  const fetchWorkflowState = useCallback(async (taskRunId: string) => {
    try {
      const res = await fetch(
        `${RUNNER_API_BASE}/task-runs/${taskRunId}/workflow-state`
      );
      if (!res.ok) return null;
      return (await res.json()) as WorkflowState;
    } catch {
      return null;
    }
  }, []);

  // Poll for running tasks and their state
  useEffect(() => {
    let active = true;

    const poll = async () => {
      const run = await findRunningTask();
      if (!active) return;

      if (run) {
        setTaskRun(run);
        taskRunRef.current = run;
        setIsPolling(true);
        const state = await fetchWorkflowState(run.id);
        if (active && state) {
          setWorkflowState(state);
          if (state.workflow_start_time) {
            const start = new Date(state.workflow_start_time).getTime();
            setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
          }
        }
      } else {
        if (taskRunRef.current) {
          setIsPolling(false);
        }
        setTaskRun(null);
        taskRunRef.current = null;
      }
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [workflowId, findRunningTask, fetchWorkflowState]);

  // Elapsed time ticker
  useEffect(() => {
    if (isPolling && workflowState?.workflow_start_time) {
      timerRef.current = setInterval(() => {
        const start = new Date(workflowState.workflow_start_time).getTime();
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      }, TIMER_INTERVAL_MS);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPolling, workflowState?.workflow_start_time]);

  // Don't render if no execution data at all
  if (!taskRun && !workflowState) {
    return null;
  }

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const getStatusIcon = () => {
    if (workflowState?.is_complete)
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    if (workflowState?.is_stopped)
      return <XCircle className="w-4 h-4 text-red-400" />;
    if (isPolling)
      return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />;
    return <Pause className="w-4 h-4 text-zinc-400" />;
  };

  const getStatusText = () => {
    if (workflowState?.is_complete) return "Completed";
    if (workflowState?.is_stopped) return "Stopped";
    if (isPolling) return "Running";
    return "Idle";
  };

  const phase = workflowState?.workflow_stage ?? workflowState?.phase;
  const phaseColor = phase
    ? (PHASE_COLORS[phase] ?? "text-zinc-400 bg-zinc-500/10 border-zinc-500/30")
    : "";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <Activity className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">
              Execution Status
            </span>
            <div className="ml-auto flex items-center gap-2">
              {getStatusIcon()}
              <span className="text-xs text-zinc-400">{getStatusText()}</span>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2">
            {/* Phase & Iteration */}
            <div className="flex items-center gap-3">
              {phase && (
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded border ${phaseColor}`}
                >
                  {workflowState?.workflow_stage_display ?? phase}
                </span>
              )}
              {workflowState?.iteration != null && (
                <span className="text-xs text-zinc-400">
                  Iteration {workflowState.iteration}
                  {workflowState.max_iterations
                    ? ` / ${workflowState.max_iterations}`
                    : ""}
                </span>
              )}
            </div>

            {/* Elapsed Time */}
            {isPolling && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Elapsed: {formatElapsed(elapsedSeconds)}</span>
              </div>
            )}

            {/* Current State */}
            {workflowState?.current_state && (
              <div className="text-xs text-zinc-500">
                State:{" "}
                <span className="text-zinc-400">
                  {workflowState.current_state.replace(/_/g, " ")}
                </span>
              </div>
            )}

            {/* Task Run ID */}
            {taskRun && (
              <div className="text-[10px] text-zinc-600 font-mono truncate">
                Run: {taskRun.id}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
