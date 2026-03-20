"use client";

import React from "react";
import type { Workflow, Action } from "@/lib/action-schema/action-types";
import type { BuilderMode, LibraryItem } from "../types";
import { isLinearWorkflow } from "../types";
import { EmptyState } from "./EmptyState";
import { SequentialEditor } from "./SequentialEditor";
import { GraphEditor } from "./GraphEditor";
import type { ActionType } from "@/lib/action-schema/action-types";

interface EditorContentProps {
  mode: BuilderMode;
  selectedItem: LibraryItem | null;
  selectedAction: Action | null;
  onSelectAction: (action: Action | null) => void;
  onUpdateActions: (actions: Action[]) => void;
  onUpdateWorkflow: (workflow: Workflow) => void;
  onAddNode: (nodeType: ActionType) => void;
  onCreateSequential: () => void;
  onCreateGraph: () => void;
}

export function EditorContent({
  mode,
  selectedItem,
  selectedAction,
  onSelectAction,
  onUpdateActions,
  onUpdateWorkflow,
  onAddNode,
  onCreateSequential,
  onCreateGraph,
}: EditorContentProps) {
  if (!selectedItem) {
    return (
      <EmptyState
        mode={mode}
        onCreateNew={mode === "sequential" ? onCreateSequential : onCreateGraph}
      />
    );
  }

  if (mode === "sequential") {
    if (!isLinearWorkflow(selectedItem)) {
      return (
        <div className="flex items-center justify-center h-full text-text-muted">
          <div className="text-center">
            <p className="text-lg">This workflow has branching logic</p>
            <p className="text-sm">Switch to graph mode to edit</p>
          </div>
        </div>
      );
    }

    return (
      <SequentialEditor
        actions={selectedItem.actions}
        selectedAction={selectedAction}
        onSelectAction={onSelectAction}
        onUpdateActions={onUpdateActions}
        onAddAction={(action) =>
          onUpdateActions([...selectedItem.actions, action])
        }
        onDeleteAction={(actionId) =>
          onUpdateActions(
            selectedItem.actions.filter((a: Action) => a.id !== actionId)
          )
        }
        onDuplicateAction={(actionId) => {
          const action = selectedItem.actions.find(
            (a: Action) => a.id === actionId
          );
          if (action) {
            const duplicated = { ...action, id: `action-${Date.now()}` };
            onUpdateActions([...selectedItem.actions, duplicated]);
          }
        }}
        onReorderActions={(startIndex, endIndex) => {
          const actions = [...selectedItem.actions];
          const [removed] = actions.splice(startIndex, 1);
          if (removed) {
            actions.splice(endIndex, 0, removed);
            onUpdateActions(actions);
          }
        }}
      />
    );
  }

  return (
    <GraphEditor
      workflow={selectedItem}
      selectedNode={selectedAction}
      onSelectNode={onSelectAction}
      onUpdateWorkflow={onUpdateWorkflow}
      onAddNode={onAddNode}
    />
  );
}
