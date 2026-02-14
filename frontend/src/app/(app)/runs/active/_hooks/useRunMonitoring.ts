"use client";

import { useRef, useEffect, useCallback } from "react";
import type { TaskRun } from "@/lib/runner-api";
import { useRunnerEvent } from "@/contexts/RunnerEventContext";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { runnerApi } from "@/lib/runner-api";
import {
  AUTO_RUN_AFTER_GENERATE_KEY,
  type AutoRunAfterGenerate,
} from "@/components/workflow-builder/AiGeneratePanel";
import { toast } from "sonner";
import type { CurrentExecutionStepsResponse } from "@/lib/runner-api";

export interface RunMonitoringResult {
  stepsData: CurrentExecutionStepsResponse | null;
  handleCompletionRefresh: () => void;
}

/**
 * Monitors a running task for completion events and handles auto-run logic.
 * Returns shared steps data and a manual refresh trigger.
 */
export function useRunMonitoring(
  _run: TaskRun | null,
  onRefresh: () => void,
  activeRuns: TaskRun[] | undefined
): RunMonitoringResult {
  const { data: stepsData } = useSharedStepsData();
  const completionRefetchedRef = useRef(false);

  // Listen for task-run-update events to detect completion
  useRunnerEvent(
    "task-run-update",
    useCallback(
      (payload: unknown) => {
        if (completionRefetchedRef.current) return;
        const msg = payload as Record<string, unknown> | null;
        if (!msg) return;
        const data = (msg.data ?? msg) as Record<string, unknown>;
        const status = data.status as string | undefined;
        if (
          status === "completed" ||
          status === "failed" ||
          status === "stopped"
        ) {
          completionRefetchedRef.current = true;
          onRefresh();
        }
      },
      [onRefresh]
    )
  );

  // Fallback: detect completion from steps data
  useEffect((): void | (() => void) => {
    if (!stepsData || completionRefetchedRef.current) return;
    const executions = stepsData.executions || [];
    if (executions.length === 0) return;

    const hasRunningOrPending = executions.some(
      (e) => e.status === "running" || e.status === "pending"
    );

    const hasCompletionStep = executions.some(
      (e) => e.phase?.toLowerCase() === "completion"
    );

    if (!hasRunningOrPending && hasCompletionStep) {
      completionRefetchedRef.current = true;
      const timer = setTimeout(() => onRefresh(), 2000);
      return () => clearTimeout(timer);
    }
  }, [stepsData, onRefresh]);

  // Auto-run: when a "Generate & Run" generation task finishes
  const autoRunHandledRef = useRef(false);
  const autoRunSeenRef = useRef(false);
  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    if (!activeRuns || autoRunHandledRef.current) return;

    let raw: string | null;
    try {
      raw = localStorage.getItem(AUTO_RUN_AFTER_GENERATE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let signal: AutoRunAfterGenerate;
    try {
      signal = JSON.parse(raw) as AutoRunAfterGenerate;
    } catch {
      localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);
      return;
    }

    if (Date.now() - signal.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);
      return;
    }

    const stillRunning = activeRuns.some((r) => r.id === signal.taskRunId);

    if (stillRunning) {
      autoRunSeenRef.current = true;
      return;
    }

    // If we never saw it running, it may have completed before this page loaded.
    // Wait a short grace period after mount to let activeRuns populate, then
    // check the task status directly via API.
    if (!autoRunSeenRef.current) {
      const elapsed = Date.now() - mountTimeRef.current;
      if (elapsed < 3000) return; // Give activeRuns time to populate
    }

    autoRunHandledRef.current = true;
    localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);

    (async () => {
      try {
        const taskRun = await runnerApi.getTaskRun(signal.taskRunId);
        if (taskRun.status === "completed") {
          const resultData = await runnerApi.getTaskRunResultData(
            signal.taskRunId
          );
          const workflowId = resultData.generated_workflow_id as
            | string
            | undefined;
          if (!workflowId) {
            toast.error(
              "Workflow generated but no workflow ID found in result data"
            );
            return;
          }
          await runnerApi.runWorkflow(workflowId);
          toast.success("Workflow generated and started!");
          onRefresh();
        } else if (taskRun.status === "running") {
          // Still running but not in activeRuns yet — reset and wait
          autoRunHandledRef.current = false;
          autoRunSeenRef.current = true;
          try {
            localStorage.setItem(AUTO_RUN_AFTER_GENERATE_KEY, raw!);
          } catch {
            // ignore
          }
        } else {
          toast.error(
            `Workflow generation ${taskRun.status === "failed" ? "failed" : "was stopped"}`
          );
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to auto-run generated workflow"
        );
      }
    })();
  }, [activeRuns, onRefresh]);

  const handleCompletionRefresh = useCallback(() => {
    completionRefetchedRef.current = false;
    onRefresh();
  }, [onRefresh]);

  return {
    stepsData,
    handleCompletionRefresh,
  };
}
