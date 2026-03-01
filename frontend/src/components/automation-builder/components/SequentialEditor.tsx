/**
 * SequentialEditor Component
 *
 * Timeline-based action editor for sequential processes.
 * Extracted from ActionEditor to be reusable with both Process and Workflow formats.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import type { SequentialEditorProps } from "../types";
import type { Action } from "@/lib/action-schema/action-types";
import { getDefaultConfig } from "./sequential-editor-utils";
import { AddActionDropdown } from "./_components/AddActionDropdown";
import { ActionInsertButton } from "./_components/ActionInsertButton";
import { ActionCard } from "./_components/ActionCard";
import { EmptyTimeline } from "./_components/EmptyTimeline";

export function SequentialEditor({
  actions,
  selectedAction,
  onSelectAction,
  onUpdateActions,
}: SequentialEditorProps) {
  const { states, workflows, images } = useAutomation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null);

  const addAction = (
    type: Action["type"],
    insertAfterIndex?: number,
    preset?: string
  ) => {
    let config = getDefaultConfig(type);

    // Handle presets for FIND action
    if (type === "FIND" && preset === "stateImage") {
      config = {
        target: {
          type: "stateImage",
          stateId: "",
          imageIds: [],
        },
      } as typeof config;
    }

    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config,
      position: [100, 100 + actions.length * 150], // Auto-position vertically
    };

    if (insertAfterIndex !== undefined && insertAfterIndex >= -1) {
      // Insert at specific position
      const updatedActions = [...actions];
      updatedActions.splice(insertAfterIndex + 1, 0, newAction);
      onUpdateActions(updatedActions);
    } else {
      // Add to end
      onUpdateActions([...actions, newAction]);
    }

    onSelectAction(newAction);
    setInsertAtIndex(null);
  };

  const deleteAction = (actionId: string) => {
    const updatedActions = actions.filter((a) => a.id !== actionId);
    onUpdateActions(updatedActions);

    if (selectedAction?.id === actionId) {
      onSelectAction(updatedActions[0] || null);
    }
  };

  const duplicateAction = (action: Action) => {
    const newAction: Action = {
      ...action,
      id: `action-${Date.now()}`,
    };

    const actionIndex = actions.findIndex((a) => a.id === action.id);
    const updatedActions = [...actions];
    updatedActions.splice(actionIndex + 1, 0, newAction);

    onUpdateActions(updatedActions);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === index) return;

    const updatedActions = [...actions];
    const draggedAction = updatedActions[draggedIndex];

    if (!draggedAction) return;

    // Remove from old position
    updatedActions.splice(draggedIndex, 1);
    // Insert at new position
    updatedActions.splice(index, 0, draggedAction);

    onUpdateActions(updatedActions);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="p-6 min-h-full flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-3xl flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">Action Timeline</h3>

        <AddActionDropdown
          onAddAction={addAction}
          trigger={
            <Button
              size="sm"
              data-tutorial-id="add-action-button"
              data-ui-id="automation-sequential-addaction-btn"
              className="bg-brand-secondary hover:bg-brand-secondary/80 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Action
            </Button>
          }
        />
      </div>

      {/* Timeline Container */}
      <div className="w-full max-w-3xl space-y-1">
        {actions.length === 0 ? (
          <EmptyTimeline />
        ) : (
          <>
            {actions.map((action, index) => (
              <div key={action.id}>
                {/* Compact Insert Button */}
                <ActionInsertButton
                  insertAfterIndex={index - 1}
                  isOpen={insertAtIndex === index - 1}
                  onOpenChange={(open) =>
                    setInsertAtIndex(open ? index - 1 : null)
                  }
                  onAddAction={addAction}
                />

                {/* Compact Action Card */}
                <ActionCard
                  action={action}
                  index={index}
                  isSelected={selectedAction?.id === action.id}
                  isDragged={draggedIndex === index}
                  states={states}
                  workflows={workflows}
                  images={images}
                  onSelect={onSelectAction}
                  onDuplicate={duplicateAction}
                  onDelete={deleteAction}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                />
              </div>
            ))}

            {/* Insert button after last action */}
            <ActionInsertButton
              insertAfterIndex={actions.length - 1}
              isOpen={insertAtIndex === actions.length - 1}
              onOpenChange={(open) =>
                setInsertAtIndex(open ? actions.length - 1 : null)
              }
              onAddAction={addAction}
            />
          </>
        )}
      </div>
    </div>
  );
}
