"use client";

import { useState, useCallback } from "react";
import { useWorkflowBuilder } from "@/components/workflow-builder/WorkflowBuilderContext";
import { PhaseSection } from "@/components/workflow-builder/PhaseSection";
import { StepItem } from "@/components/workflow-builder/StepItem";
import { AddStepDropdown } from "@/components/workflow-builder/AddStepDropdown";
import { createDefaultStep, type UnifiedStep, type WorkflowPhase } from "@/types/unified-workflow";

export function PhaseStepRenderer({
  phase,
  steps,
}: {
  phase: WorkflowPhase;
  steps: UnifiedStep[];
}) {
  const { state, selectStep, removeStep, duplicateStep, addStep } = useWorkflowBuilder();
  const [showAddStep, setShowAddStep] = useState(false);

  const handleQuickAddStep = useCallback(
    (type: string, targetPhase: WorkflowPhase) => {
      // createDefaultStep returns the wire-side UnifiedStep (open `Other`
      // variant); the defaults factory only produces canonical shapes, so
      // narrow to the web's strict view here.
      const step = createDefaultStep(
        type as UnifiedStep["type"],
        targetPhase,
      ) as UnifiedStep;
      addStep(step, targetPhase);
    },
    [addStep]
  );

  const renderStep = useCallback(
    (step: UnifiedStep, index: number) => (
      <StepItem
        step={step}
        phase={phase}
        index={index}
        isSelected={state.selectedStepId === step.id}
        onDuplicate={() => duplicateStep(step.id, phase)}
        onDelete={() => removeStep(step.id, phase)}
        onClick={() => selectStep(step.id)}
      />
    ),
    [phase, state.selectedStepId, duplicateStep, removeStep, selectStep]
  );

  return (
    <>
      <PhaseSection
        phase={phase}
        steps={steps}
        onAddStep={() => setShowAddStep(true)}
        onQuickAddStep={handleQuickAddStep}
        renderStep={renderStep}
      />
      {showAddStep && (
        <AddStepDropdown
          phase={phase}
          isOpen={showAddStep}
          onClose={() => setShowAddStep(false)}
          onAddStep={addStep}
        />
      )}
    </>
  );
}
