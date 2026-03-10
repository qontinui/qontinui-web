"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDragSource } from "@qontinui/ui-bridge";
import { ChevronUp, ChevronDown, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STEP_TYPE_META, type SpecStep } from "../spec-workflow-types";

// ---------------------------------------------------------------------------
// Sortable Step Item
// ---------------------------------------------------------------------------

interface SortableStepItemProps {
  step: SpecStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export function SortableStepItem({
  step,
  index,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  isFirst,
  isLast,
}: SortableStepItemProps) {
  const meta = STEP_TYPE_META[step.type];
  const Icon = meta.icon;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });
  useDragSource(step.id, { dataType: "spec-step" });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
        isDragging && "opacity-50",
        isSelected
          ? "bg-zinc-700/80 ring-1 ring-zinc-500"
          : "hover:bg-zinc-800/60"
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        className="touch-none cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 shrink-0"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {/* Step number */}
      <span className="shrink-0 w-5 h-5 flex items-center justify-center bg-zinc-700 text-zinc-300 text-xs font-medium rounded">
        {index + 1}
      </span>

      {/* Icon */}
      <Icon className={cn("w-4 h-4 shrink-0", meta.color)} />

      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">{step.name}</div>
        <div className="text-xs text-zinc-500 truncate">{meta.label}</div>
      </div>

      {/* Reorder + delete */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          disabled={isFirst}
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          title="Move up"
        >
          <ChevronUp className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          disabled={isLast}
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          title="Move down"
        >
          <ChevronDown className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete step"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
