"use client";

import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { ExecutionPhaseProps } from "../_types/orchestrator-types";
import { PlanVisualization } from "./PlanVisualization";
import { ExecutionLog } from "./ExecutionLog";

export function ExecutionPhase({
  plan,
  executionResult,
  executing,
  currentStepIndex,
}: ExecutionPhaseProps) {
  if (executing && plan) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary">
            Executing Plan
          </h3>
          <span className="text-xs text-text-muted">
            Step {currentStepIndex + 1} of {plan.steps.length}
          </span>
        </div>

        <Progress
          value={((currentStepIndex + 1) / plan.steps.length) * 100}
          variant="brand-primary"
          className="h-2"
        />

        <PlanVisualization
          plan={plan}
          currentStepIndex={currentStepIndex}
          isExecuting
        />

        <div className="flex items-center justify-center p-4 gap-2">
          <Loader2 className="size-5 text-blue-400 animate-spin" />
          <span className="text-sm text-text-secondary">
            Running {plan.steps[currentStepIndex]?.name || "..."}
          </span>
        </div>
      </div>
    );
  }

  if (!executionResult) return null;

  return (
    <div className="p-4 space-y-4">
      <ExecutionLog result={executionResult} />
    </div>
  );
}
