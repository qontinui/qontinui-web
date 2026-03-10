"use client";

import React from "react";
import {
  Bot,
  Terminal,
  TestTube2,
  Eye,
  Code,
  Package,
  MessageSquare,
  Monitor,
  Activity,
  AlertTriangle,
  CheckCircle,
  Workflow,
  GripVertical,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDragSource } from "@qontinui/ui-bridge";
import type {
  UnifiedStep,
  WorkflowPhase,
  PromptStep,
} from "@/types/unified-workflow";
import { StepItemConcrete } from "@qontinui/workflow-ui/components";

// =============================================================================
// Icon Resolver
// =============================================================================

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  "message-square": MessageSquare,
  "test-tube-2": TestTube2,
  monitor: Monitor,
  "alert-triangle": AlertTriangle,
  "check-circle": CheckCircle,
  workflow: Workflow,
  activity: Activity,
  eye: Eye,
  code: Code,
  package: Package,
  bot: Bot,
};

function resolveIcon(
  iconId: string
): React.ComponentType<{ className?: string }> {
  return ICON_MAP[iconId] ?? Activity;
}

// =============================================================================
// Props
// =============================================================================

interface StepItemProps {
  step: UnifiedStep;
  phase: WorkflowPhase;
  index: number;
  isSelected: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onClick: () => void;
}

// =============================================================================
// Component — SortableItem wrapper around StepItemConcrete
// =============================================================================

export function StepItem({
  step,
  phase: _phase,
  index: _index,
  isSelected,
  onDuplicate,
  onDelete,
  onClick,
}: StepItemProps) {
  const isSummaryStep =
    step.type === "prompt" && (step as PromptStep).is_summary_step;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id, disabled: !!isSummaryStep });
  useDragSource(step.id, { dataType: "workflow-step" });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandle = (
    <button
      className="touch-none cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 shrink-0"
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : ""}
    >
      <StepItemConcrete
        step={step}
        isSelected={isSelected}
        onClick={onClick}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        reorderSlot={dragHandle}
        resolveIcon={resolveIcon}
      />
    </div>
  );
}
