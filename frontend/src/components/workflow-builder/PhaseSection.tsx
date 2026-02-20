"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Terminal,
  Monitor,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { PHASE_INFO } from "@/types/unified-workflow";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";

const PHASE_COLORS: Record<
  WorkflowPhase,
  { bg: string; border: string; text: string; badge: string }
> = {
  setup: {
    bg: "bg-blue-950/30",
    border: "border-blue-800/50",
    text: "text-blue-400",
    badge: "bg-blue-900/50 text-blue-300",
  },
  verification: {
    bg: "bg-green-950/30",
    border: "border-green-800/50",
    text: "text-green-400",
    badge: "bg-green-900/50 text-green-300",
  },
  agentic: {
    bg: "bg-amber-950/30",
    border: "border-amber-800/50",
    text: "text-amber-400",
    badge: "bg-amber-900/50 text-amber-300",
  },
  completion: {
    bg: "bg-purple-950/30",
    border: "border-purple-800/50",
    text: "text-purple-400",
    badge: "bg-purple-900/50 text-purple-300",
  },
};

interface PhaseSectionProps {
  phase: WorkflowPhase;
  steps: UnifiedStep[];
  onAddStep: (phase: WorkflowPhase) => void;
  onQuickAddStep?: (type: string, phase: WorkflowPhase) => void;
  renderStep: (step: UnifiedStep, index: number) => React.ReactNode;
}

export function PhaseSection({
  phase,
  steps,
  onAddStep,
  onQuickAddStep,
  renderStep,
}: PhaseSectionProps) {
  const { state, togglePhase, removeStep, reorderSteps } = useWorkflowBuilder();
  const isExpanded = state.expandedPhases[phase];
  const colors = PHASE_COLORS[phase];
  const info = PHASE_INFO[phase];
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(
    new Set(),
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleBatchDelete = () => {
    selectedForDelete.forEach((stepId) => removeStep(stepId, phase));
    setSelectedForDelete(new Set());
    setIsSelectionMode(false);
  };

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

  const sortableIds = steps.map((s) => s.id);

  // Quick-add: for agentic phase only show prompt
  const quickAddTypes =
    phase === "agentic"
      ? [{ type: "prompt", icon: Bot, title: "Add Prompt" }]
      : [
          { type: "command", icon: Terminal, title: "Add Command" },
          { type: "ui_bridge", icon: Monitor, title: "Add UI Bridge" },
          { type: "prompt", icon: Bot, title: "Add Prompt" },
        ];

  return (
    <Collapsible open={isExpanded} onOpenChange={() => togglePhase(phase)}>
      <div className={`rounded-lg border ${colors.border} ${colors.bg}`}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between px-3 py-2 cursor-pointer select-none">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className={`w-4 h-4 ${colors.text}`} />
              ) : (
                <ChevronRight className={`w-4 h-4 ${colors.text}`} />
              )}
              <span className={`text-sm font-semibold ${colors.text}`}>
                {info.label}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${colors.badge}`}>
                {steps.length}
              </span>
            </div>
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {isSelectionMode && selectedForDelete.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                  onClick={handleBatchDelete}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete ({selectedForDelete.size})
                </Button>
              )}
              {steps.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-zinc-400"
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setSelectedForDelete(new Set());
                  }}
                >
                  {isSelectionMode ? "Cancel" : "Select"}
                </Button>
              )}
              {onQuickAddStep &&
                quickAddTypes.map(({ type, icon: QIcon, title }) => (
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
              <Button
                variant="ghost"
                size="sm"
                className={`h-6 px-2 text-xs ${colors.text}`}
                onClick={() => onAddStep(phase)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Collapsed summary: show first few step names */}
        {!isExpanded && steps.length > 0 && (
          <div className="px-3 pb-2 text-xs text-zinc-500 truncate">
            {steps
              .slice(0, 3)
              .map((s) => s.name)
              .join(" \u2192 ")}
            {steps.length > 3 && ` +${steps.length - 3} more`}
          </div>
        )}

        <CollapsibleContent>
          <div className="px-2 pb-2">
            <p className="text-xs text-zinc-500 px-1 mb-2">
              {info.description}
            </p>
            {steps.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs text-zinc-500 mb-2">No steps yet</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onAddStep(phase)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Step
                </Button>
              </div>
            ) : (
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
                    {steps.map((step, index) => (
                      <div key={step.id} className="flex items-center gap-1">
                        {isSelectionMode && (
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 rounded"
                            checked={selectedForDelete.has(step.id)}
                            onChange={() => {
                              const next = new Set(selectedForDelete);
                              if (next.has(step.id)) next.delete(step.id);
                              else next.add(step.id);
                              setSelectedForDelete(next);
                            }}
                          />
                        )}
                        <div className="flex-1">{renderStep(step, index)}</div>
                      </div>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
