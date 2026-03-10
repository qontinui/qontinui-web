"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Trash2,
  Loader2,
  ListChecks,
  Layers,
  Save,
  X,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableQueueItem } from "./SortableQueueItem";
import { useDropZone } from "@qontinui/ui-bridge";

export interface QueueItem {
  queueId: string;
  workflowId: string;
  name: string;
  description?: string;
  category?: string;
  stepCount: number;
  phaseCount: number;
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
  onSaveAsWorkflow?: () => void;
  showSaveDialog?: boolean;
  onCloseSaveDialog?: () => void;
  onConfirmSave?: (name: string, description: string, category: string) => void;
}

export function SequenceBuilderPanel({
  items,
  stopOnFailure,
  isRunning,
  onItemsChange,
  onStopOnFailureChange,
  onRun,
  onClear,
  onSaveAsWorkflow,
  showSaveDialog,
  onCloseSaveDialog,
  onConfirmSave,
}: SequenceBuilderPanelProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: "sequence-drop-zone",
  });
  useDropZone("sequence-drop-zone", {
    accepts: ["workflow", "queue-item"],
    effect: "reorder",
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
  const totalPhases = items.reduce((sum, item) => sum + item.phaseCount, 0);

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
                    phaseCount={item.phaseCount}
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

          {/* Bottom bar — always visible so Run/Save buttons satisfy UI Bridge specs */}
          <div className="pt-3 border-t border-border-subtle/30 space-y-3">
            {items.length > 0 && (
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>
                  {totalPhases} phase{totalPhases !== 1 ? "s" : ""} &bull;{" "}
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
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-red-400 border-red-500/30 hover:bg-red-950/30"
                disabled={items.length === 0}
                onClick={onClear}
              >
                <Trash2 className="size-3.5 mr-1" />
                Clear
              </Button>
              <div className="flex-1" />
              {onSaveAsWorkflow && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={items.length < 2}
                  onClick={onSaveAsWorkflow}
                >
                  <Save className="size-3.5 mr-1" />
                  Save as Workflow
                </Button>
              )}
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
        </CardContent>
      </Card>

      {/* Save Composed Workflow Dialog */}
      {showSaveDialog && onConfirmSave && onCloseSaveDialog && (
        <SaveComposedDialog
          items={items}
          onSave={onConfirmSave}
          onClose={onCloseSaveDialog}
        />
      )}
    </div>
  );
}

// =============================================================================
// Save Composed Workflow Dialog
// =============================================================================

function SaveComposedDialog({
  items,
  onSave,
  onClose,
}: {
  items: QueueItem[];
  onSave: (name: string, description: string, category: string) => void;
  onClose: () => void;
}) {
  const suggestedName = items.map((i) => i.name).join(" + ");
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");

  const totalPhases = items.reduce((sum, item) => sum + item.phaseCount, 0);

  return (
    <Card className="bg-surface-raised border-border-subtle">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Save as Composed Workflow</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label
            htmlFor="sbp-name"
            className="text-xs text-text-muted block mb-1"
          >
            Name
          </label>
          <input
            id="sbp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-8 px-3 text-sm bg-surface-canvas/50 border border-border-subtle rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-primary"
            placeholder="Workflow name"
          />
        </div>

        <div>
          <label
            htmlFor="sbp-category"
            className="text-xs text-text-muted block mb-1"
          >
            Category
          </label>
          <input
            id="sbp-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-8 px-3 text-sm bg-surface-canvas/50 border border-border-subtle rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-primary"
            placeholder="general"
          />
        </div>

        <div>
          <label
            htmlFor="sbp-description"
            className="text-xs text-text-muted block mb-1"
          >
            Description
          </label>
          <textarea
            id="sbp-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-20 px-3 py-2 text-sm bg-surface-canvas/50 border border-border-subtle rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-primary resize-none"
            placeholder="Describe this composed workflow..."
          />
        </div>

        {/* Preview */}
        <div className="text-xs text-text-muted space-y-1">
          <p className="font-medium text-text-secondary">
            Preview: {totalPhases} phases
          </p>
          {items.map((item, i) => (
            <div
              key={item.queueId}
              className="pl-2 border-l border-border-subtle/50"
            >
              {item.phaseCount === 1 ? (
                <span>
                  Phase {i + 1}: {item.name}
                </span>
              ) : (
                <span>
                  {item.name} ({item.phaseCount} phases)
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              onSave(
                name.trim(),
                description.trim(),
                category.trim() || "general"
              )
            }
          >
            <Save className="size-3.5 mr-1" />
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
