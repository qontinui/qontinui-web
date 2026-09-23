"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as workflowApi from "@/lib/api/unified-workflows";
import { useDispatchRunnerApi } from "@/lib/runner-api";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { toast } from "sonner";

export function useWorkflowPageActions(
  setSelectedWorkflow: (w: UnifiedWorkflow) => void,
) {
  // Calls that START work go to the new-work target (explicit choice or
  // coord's resolved pick); a refused call carries coord's outcome.
  const { api: workApi, refusal: runRefusal } = useDispatchRunnerApi();
  const router = useRouter();
  const [isCreatingManually, setIsCreatingManually] = useState(false);

  const handleCreateManually = async () => {
    setIsCreatingManually(true);
    try {
      const newWorkflow = await workflowApi.createWorkflow({
        name: "New Workflow",
        description: "",
        setupSteps: [],
        verificationSteps: [],
        agenticSteps: [],
        completionSteps: [],
      });
      setSelectedWorkflow(newWorkflow);
    } catch {
      toast.error("Failed to create workflow");
    } finally {
      setIsCreatingManually(false);
    }
  };

  const handleRunWorkflow = async (workflowId: string) => {
    try {
      await workApi.runWorkflow(workflowId);
      toast.success("Workflow started!");
      router.push("/runs/active");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start workflow"
      );
    }
  };

  const handleNavigateToActiveRuns = (_taskRunId: string) => {
    router.push("/runs/active");
  };

  return {
    /** Coord's reason no workflow run may start right now (null = allowed). */
    runRefusal,
    isCreatingManually,
    handleCreateManually,
    handleRunWorkflow,
    handleNavigateToActiveRuns,
  };
}
