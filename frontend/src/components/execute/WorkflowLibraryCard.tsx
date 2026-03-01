"use client";

import { Button } from "@/components/ui/button";
import { Plus, Check } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import {
  getTotalStepCount,
  type UnifiedWorkflow,
} from "@/types/unified-workflow";

interface WorkflowLibraryCardProps {
  workflow: UnifiedWorkflow;
  isQueued: boolean;
  onAdd: (workflow: UnifiedWorkflow) => void;
}

export function WorkflowLibraryCard({
  workflow,
  isQueued,
  onAdd,
}: WorkflowLibraryCardProps) {
  const stepCount = getTotalStepCount(workflow);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${workflow.id}`,
    data: { workflow },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-3 rounded-lg bg-surface-canvas/50 border border-border-subtle/30 hover:border-border-default transition-all cursor-grab active:cursor-grabbing touch-none ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-sm font-medium text-text-primary truncate">
              {workflow.name}
            </span>
            <span className="text-[10px] text-text-muted shrink-0 ml-2">
              {stepCount} step{stepCount !== 1 ? "s" : ""}
            </span>
          </div>
          {workflow.description && (
            <p className="text-xs text-text-muted line-clamp-1">
              {workflow.description}
            </p>
          )}
          {workflow.category && (
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-text-muted mt-1">
              {workflow.category}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(workflow);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {isQueued ? (
            <>
              <Check className="size-3 mr-1 text-green-400" />
              Add Again
            </>
          ) : (
            <>
              <Plus className="size-3 mr-1" />
              Add
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
