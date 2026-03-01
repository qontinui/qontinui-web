"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as workflowApi from "@/lib/api/unified-workflows";
import { runnerApi } from "@/lib/runner-api";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { toast } from "sonner";

export function useWorkflowPageActions(
  setSelectedWorkflow: (w: UnifiedWorkflow) => void,
) {
  const router = useRouter();
  const [isCreatingManually, setIsCreatingManually] = useState(false);

  const handleCreateManually = async () => {
    setIsCreatingManually(true);
    try {
      const newWorkflow = await workflowApi.createWorkflow({
        name: "New Workflow",
        description: "",
        setup_steps: [],
        verification_steps: [],
        agentic_steps: [],
        completion_steps: [],
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
      await runnerApi.runWorkflow(workflowId);
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
    isCreatingManually,
    handleCreateManually,
    handleRunWorkflow,
    handleNavigateToActiveRuns,
  };
}
