import { runnerApi } from "@/lib/runner/runner-api-object";

export async function pollForGeneratedWorkflow(
  taskRunId: string,
  maxWaitMs = 300_000,
  intervalMs = 3000
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const taskRun = await runnerApi.getTaskRun(taskRunId);
      const status = taskRun.status?.toLowerCase();

      if (status === "completed" || status === "success") {
        try {
          const resultData = await runnerApi.getTaskRunResultData(taskRunId);
          const data =
            (resultData as Record<string, unknown>).data || resultData;
          if (
            typeof (data as Record<string, unknown>).workflow_id === "string"
          ) {
            return (data as Record<string, unknown>).workflow_id as string;
          }
        } catch {
          // Result data may not have workflow_id
        }

        try {
          const state = await runnerApi.getTaskRunWorkflowState(taskRunId);
          const stateData = (state as Record<string, unknown>).data || state;
          if (
            typeof (stateData as Record<string, unknown>)
              .generated_workflow_id === "string"
          ) {
            return (stateData as Record<string, unknown>)
              .generated_workflow_id as string;
          }
        } catch {
          // Workflow state may not have generated_workflow_id
        }

        return null;
      }

      if (status === "failed" || status === "error" || status === "cancelled") {
        return null;
      }
    } catch {
      // Task run fetch failed, keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}
