"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as workflowApi from "@/lib/api/unified-workflows";
import { parseInsertStepParam } from "@/lib/insert-into-workflow";
import type { UnifiedStep, UnifiedWorkflow } from "@/types/unified-workflow";
import { toast } from "sonner";

export function useInsertStep(
  selectedWorkflow: UnifiedWorkflow | null,
  setSelectedWorkflow: (w: UnifiedWorkflow) => void,
) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingInsertStep, setPendingInsertStep] = useState<Partial<UnifiedStep> | null>(null);
  const [isCreatingForInsert, setIsCreatingForInsert] = useState(false);

  // Handle insertStep query parameter from builder pages
  useEffect(() => {
    const insertParam = searchParams.get("insertStep");
    if (insertParam) {
      const stepData = parseInsertStepParam(insertParam);
      if (stepData) {
        setPendingInsertStep(stepData);
        // Clean URL
        router.replace("/build/workflows");
      }
    }
  }, [searchParams, router]);

  // When we have a pending insert step and a workflow is selected, add it
  useEffect(() => {
    if (pendingInsertStep && selectedWorkflow) {
      // Will be handled by WorkflowEditor via the pendingInsertStep prop
    }
  }, [pendingInsertStep, selectedWorkflow]);

  // Auto-create workflow when insert step arrives without a selected workflow
  useEffect(() => {
    if (pendingInsertStep && !selectedWorkflow && !isCreatingForInsert) {
      (async () => {
        setIsCreatingForInsert(true);
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
          setPendingInsertStep(null);
        } finally {
          setIsCreatingForInsert(false);
        }
      })();
    }
  }, [pendingInsertStep, selectedWorkflow, isCreatingForInsert, setSelectedWorkflow]);

  const consumeInsertStep = () => setPendingInsertStep(null);

  return { pendingInsertStep, consumeInsertStep };
}
