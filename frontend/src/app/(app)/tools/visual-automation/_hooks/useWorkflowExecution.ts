import { useState } from "react";
import { runnerApi } from "@/lib/runner-api";
import type { RunResult } from "../_types";

export function useWorkflowExecution() {
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const handleRun = async (workflowId: string) => {
    setIsRunning(true);
    setRunResult(null);
    try {
      const result = await runnerApi.runWorkflow(workflowId);
      setRunResult({ success: true, taskRunId: result.task_run_id });
    } catch (err) {
      setRunResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to start workflow",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return { isRunning, runResult, handleRun };
}
