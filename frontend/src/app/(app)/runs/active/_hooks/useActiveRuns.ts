"use client";

import { useState, useRef, useEffect } from "react";
import { runnerApi, type TaskRun } from "@/lib/runner";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { runnerFetch } from "@/lib/runner/api-client";
import { toast } from "sonner";
import {
  AUTO_RUN_AFTER_GENERATE_KEY,
  type AutoRunAfterGenerate,
} from "@/components/workflow-builder/AiGeneratePanel";

export function useActiveRuns() {
  const {
    data: activeRuns,
    isLoading,
    isOffline,
    refetch: refetchRuns,
  } = useEventTriggeredFetch<TaskRun[]>(
    "task-run-update",
    "/task-runs/running"
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const lastKnownRunIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (activeRuns && activeRuns.length > 0) {
      lastKnownRunIds.current = new Set(activeRuns.map((r) => r.id));
    }
  }, [activeRuns]);

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
      if (elapsed < 3000) return;
    }

    autoRunHandledRef.current = true;
    localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);

    (async () => {
      try {
        const taskRun = await runnerApi.getTaskRun(signal.taskRunId);
        if (taskRun.status === "completed") {
          const resultData = await runnerFetch<Record<string, unknown>>(
            `/task-runs/${signal.taskRunId}/result-data`
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
          refetchRuns();
        } else if (taskRun.status === "running") {
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
  }, [activeRuns, refetchRuns]);

  const runs = activeRuns || [];
  const selectedRun =
    runs.find((r) => r.id === selectedRunId) || runs[0] || null;
  const currentRunId = selectedRun?.id || null;

  return {
    runs,
    isLoading,
    isOffline,
    selectedRunId: currentRunId,
    selectedRun,
    setSelectedRunId,
    refetchRuns,
    lastKnownRunIds,
  };
}
