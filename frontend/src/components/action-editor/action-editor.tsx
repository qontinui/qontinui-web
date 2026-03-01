"use client";

import { useState } from "react";
import { useAutomation } from "@/contexts/automation-context";
import type { Action, ActionEditorProps } from "./action-editor-types";
import { getDefaultConfig } from "./action-editor-utils";
import { AddActionMenu } from "./_components/add-action-menu";
import { ActionListItem } from "./_components/action-list-item";
import { EmptyActionsPlaceholder } from "./_components/empty-actions-placeholder";

export function ActionEditor({
  process,
  selectedAction,
  onSelectAction,
  onUpdateProcess,
}: ActionEditorProps) {
  const { states, workflows, images } = useAutomation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const addAction = (type: Action["type"]) => {
    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config: getDefaultConfig(type),
    };

    const updatedProcess = {
      ...process,
      actions: [...process.actions, newAction],
    };

    onUpdateProcess(updatedProcess);
    onSelectAction(newAction);
  };

  const deleteAction = (actionId: string) => {
    const updatedProcess = {
      ...process,
      actions: process.actions.filter((a) => a.id !== actionId),
    };
    onUpdateProcess(updatedProcess);
    if (selectedAction?.id === actionId && process.actions[0]) {
      onSelectAction(process.actions[0]);
    }
  };

  const duplicateAction = (action: Action) => {
    const newAction: Action = {
      ...action,
      id: `action-${Date.now()}`,
    };

    const actionIndex = process.actions.findIndex((a) => a.id === action.id);
    const updatedActions = [...process.actions];
    updatedActions.splice(actionIndex + 1, 0, newAction);

    const updatedProcess = {
      ...process,
      actions: updatedActions,
    };

    onUpdateProcess(updatedProcess);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === index) return;

    const updatedActions = [...process.actions];
    const draggedAction = updatedActions[draggedIndex];

    if (!draggedAction) return;

    // Remove from old position
    updatedActions.splice(draggedIndex, 1);
    // Insert at new position
    updatedActions.splice(index, 0, draggedAction);

    onUpdateProcess({
      ...process,
      actions: updatedActions,
    });

    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Action Timeline</h3>
        <AddActionMenu onAddAction={addAction} />
      </div>

      <div className="space-y-2">
        {process.actions.length === 0 ? (
          <EmptyActionsPlaceholder />
        ) : (
          process.actions.map((action, index) => (
            <ActionListItem
              key={action.id}
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
          ))
        )}
      </div>
    </div>
  );
}
