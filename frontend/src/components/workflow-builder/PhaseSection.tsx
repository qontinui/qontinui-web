"use client";

import React from "react";
import { Terminal, Monitor, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { UnifiedStep, WorkflowPhase } from "@/types/unified-workflow";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { PhaseSectionConcrete } from "@qontinui/workflow-ui/components";
import { useDropZone } from "@qontinui/ui-bridge";

// =============================================================================
// Props
// =============================================================================

interface PhaseSectionProps {
  phase: WorkflowPhase;
  steps: UnifiedStep[];
  onAddStep: (phase: WorkflowPhase) => void;
  onQuickAddStep?: (type: string, phase: WorkflowPhase) => void;
  renderStep: (step: UnifiedStep, index: number) => React.ReactNode;
}

// =============================================================================
// Component — DnD wrapper around PhaseSectionConcrete
// =============================================================================

export function PhaseSection({
  phase,
  steps,
  onAddStep,
  onQuickAddStep,
  renderStep,
}: PhaseSectionProps) {
  const { state, togglePhase, removeStep, reorderSteps } = useWorkflowBuilder();
  const isExpanded = state.expandedPhases[phase];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  useDropZone("workflow-step-list", {
    accepts: ["workflow-step"],
    effect: "reorder",
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const stepIds = steps.map((s) => s.id);
    const oldIndex = stepIds.indexOf(active.id as string);
    const newIndex = stepIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(stepIds, oldIndex, newIndex);
    reorderSteps(phase, newOrder);
  };

  // Quick-add types for header
  const quickAddTypes =
    phase === "agentic"
      ? [{ type: "prompt", icon: Bot, title: "Add Prompt" }]
      : [
          { type: "command", icon: Terminal, title: "Add Command" },
          { type: "ui_bridge", icon: Monitor, title: "Add UI Bridge" },
          { type: "prompt", icon: Bot, title: "Add Prompt" },
        ];

  const headerActions = onQuickAddStep ? (
    <>
      {quickAddTypes.map(({ type, icon: QIcon, title }) => (
        <Button
          key={type}
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300"
          onClick={() => onQuickAddStep(type, phase)}
          title={title}
        >
          <QIcon className="w-3.5 h-3.5" />
        </Button>
      ))}
    </>
  ) : undefined;

  const hasSelectedStep = state.selectedStepId
    ? steps.some((s) => s.id === state.selectedStepId)
    : false;

  return (
    <PhaseSectionConcrete
      phase={phase}
      steps={steps}
      isExpanded={isExpanded}
      onToggle={() => togglePhase(phase)}
      onAddStep={onAddStep}
      hasSelectedStep={hasSelectedStep}
      headerActions={headerActions}
      onBatchDelete={(ids) => ids.forEach((id) => removeStep(id, phase))}
      renderStepList={(
        stepsToRender,
        _isSelectionMode,
        _selectedIds,
        _onToggleSelect
      ) => {
        // workflow-ui's wire `UnifiedStep` includes an open `Other` variant
        // with `id: unknown`; runner/web-produced steps are always canonical,
        // so narrow here for dnd/key access.
        const typedSteps = stepsToRender as UnifiedStep[];
        const sortableIds = typedSteps.map((s) => s.id);
        return (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortableIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {typedSteps.map((step, index) => (
                  <div key={step.id} className="flex-1">
                    {renderStep(step, index)}
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        );
      }}
    />
  );
}
