"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GripVertical, X, Calendar } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

interface SortableQueueItemProps {
  queueId: string;
  position: number;
  name: string;
  description?: string;
  stepCount: number;
  scheduledAt?: string;
  onRemove: () => void;
  onScheduleChange: (scheduledAt: string | null) => void;
}

export function SortableQueueItem({
  queueId,
  position,
  name,
  stepCount,
  scheduledAt,
  onRemove,
  onScheduleChange,
}: SortableQueueItemProps) {
  const [showSchedule, setShowSchedule] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: queueId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-3 bg-surface-raised/50 border border-border-subtle/50 rounded-lg group hover:border-border-default transition-all",
        isDragging && "opacity-50 z-50"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </div>

        <div className="w-7 h-7 bg-surface-hover rounded-lg flex items-center justify-center shrink-0">
          <span className="text-xs font-mono text-text-muted">{position}</span>
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-text-primary truncate">
            {name}
          </h4>
          <span className="text-[10px] text-text-muted">
            {stepCount} step{stepCount !== 1 ? "s" : ""}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0 transition-all",
            scheduledAt
              ? "text-brand-primary hover:text-brand-primary/80"
              : "text-text-muted hover:text-text-secondary opacity-0 group-hover:opacity-100"
          )}
          onClick={() => {
            if (scheduledAt) {
              setShowSchedule(!showSchedule);
            } else {
              const defaultTime = new Date(Date.now() + 3600000)
                .toISOString()
                .slice(0, 16);
              onScheduleChange(defaultTime);
              setShowSchedule(true);
            }
          }}
        >
          <Calendar className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-text-muted hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Schedule row */}
      {(showSchedule || scheduledAt) && (
        <div className="flex items-center gap-2 mt-2 ml-[52px]">
          <Calendar className="size-3 text-text-muted shrink-0" />
          <input
            type="datetime-local"
            value={scheduledAt || ""}
            onChange={(e) => onScheduleChange(e.target.value || null)}
            className="text-xs h-6 px-2 bg-surface-canvas/50 border border-border-subtle/50 rounded text-text-primary flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-text-muted hover:text-red-400"
            onClick={() => {
              onScheduleChange(null);
              setShowSchedule(false);
            }}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
