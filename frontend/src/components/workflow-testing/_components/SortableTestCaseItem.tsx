"use client";

import { GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TestCase } from "@/services/workflow-testing-service";

interface SortableTestCaseItemProps {
  testCase: TestCase;
  index: number;
  onRemove: (id: string) => void;
}

export function SortableTestCaseItem({
  testCase,
  index,
  onRemove,
}: SortableTestCaseItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: testCase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 border rounded-md bg-card",
        isDragging && "opacity-50"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="size-5" />
      </button>

      <div className="flex items-center justify-center size-6 rounded-full bg-accent text-xs font-medium">
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{testCase.name}</p>
        {testCase.description && (
          <p className="text-xs text-muted-foreground truncate">
            {testCase.description}
          </p>
        )}
      </div>

      <Button onClick={() => onRemove(testCase.id)} variant="ghost" size="sm">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
