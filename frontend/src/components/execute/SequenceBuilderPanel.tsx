"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Trash2, Loader2, ListChecks, Layers } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableQueueItem } from "./SortableQueueItem";

export interface QueueItem {
  queueId: string;
  workflowId: string;
  name: string;
  description?: string;
  category?: string;
  stepCount: number;
  scheduledAt?: string;
}

interface SequenceBuilderPanelProps {
  items: QueueItem[];
  stopOnFailure: boolean;
  isRunning: boolean;
  onItemsChange: (items: QueueItem[]) => void;
  onStopOnFailureChange: (value: boolean) => void;
  onRun: () => void;
  onClear: () => void;
}

export function SequenceBuilderPanel({
  items,
  stopOnFailure,
  isRunning,
  onItemsChange,
  onStopOnFailureChange,
  onRun,
  onClear,
}: SequenceBuilderPanelProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: "sequence-drop-zone",
  });

  const handleRemove = (queueId: string) => {
    onItemsChange(items.filter((i) => i.queueId !== queueId));
  };

  const handleScheduleChange = (
    queueId: string,
    scheduledAt: string | null
  ) => {
    onItemsChange(
      items.map((item) =>
        item.queueId === queueId
          ? { ...item, scheduledAt: scheduledAt || undefined }
          : item
      )
    );
  };

  const totalSteps = items.reduce((sum, item) => sum + item.stepCount, 0);

  return (
    <div className="flex-1 min-w-0 space-y-4">
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="size-4" />
              Sequence Builder
            </CardTitle>
            <span className="text-xs text-text-muted">
              {items.length} workflow{items.length !== 1 ? "s" : ""}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Sortable Queue with Drop Zone */}
          <div
            ref={setDropRef}
            className={`space-y-2 min-h-[120px] rounded-lg transition-colors ${
              isOver ? "bg-brand-primary/5 ring-2 ring-brand-primary/30" : ""
            }`}
          >
            {items.length === 0 ? (
              <div
                className={`p-8 border-2 border-dashed rounded-lg text-center transition-colors ${
                  isOver
                    ? "border-brand-primary/50 bg-brand-primary/5"
                    : "border-border-subtle/50"
                }`}
              >
                <ListChecks className="size-8 mx-auto mb-2 text-text-muted" />
                <p className="text-sm text-text-muted">
                  {isOver
                    ? "Drop here to add"
                    : "Drag workflows from the library or click Add"}
                </p>
              </div>
            ) : (
              <SortableContext
                items={items.map((i) => i.queueId)}
                strategy={verticalListSortingStrategy}
              >
                {items.map((item, index) => (
                  <SortableQueueItem
                    key={item.queueId}
                    queueId={item.queueId}
                    position={index + 1}
                    name={item.name}
                    description={item.description}
                    stepCount={item.stepCount}
                    scheduledAt={item.scheduledAt}
                    onRemove={() => handleRemove(item.queueId)}
                    onScheduleChange={(scheduledAt) =>
                      handleScheduleChange(item.queueId, scheduledAt)
                    }
                  />
                ))}
              </SortableContext>
            )}
          </div>

          {/* Bottom bar */}
          {items.length > 0 && (
            <div className="pt-3 border-t border-border-subtle/30 space-y-3">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>
                  {items.length} workflow{items.length !== 1 ? "s" : ""} &bull;{" "}
                  {totalSteps} total step{totalSteps !== 1 ? "s" : ""}
                </span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={stopOnFailure}
                    onChange={(e) => onStopOnFailureChange(e.target.checked)}
                    className="rounded border-border-subtle"
                  />
                  <span>Stop on failure</span>
                </label>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-400 border-red-500/30 hover:bg-red-950/30"
                  onClick={onClear}
                >
                  <Trash2 className="size-3.5 mr-1" />
                  Clear
                </Button>
                <div className="flex-1" />
                <Button
                  variant="brand-primary"
                  size="sm"
                  disabled={isRunning || items.length === 0}
                  onClick={onRun}
                >
                  {isRunning ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Play className="size-3.5 mr-1" />
                  )}
                  Run
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
