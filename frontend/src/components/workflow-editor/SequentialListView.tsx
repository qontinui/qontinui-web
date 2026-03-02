/**
 * Sequential List View Component
 *
 * Displays workflow actions in a numbered list format (for sequential workflows).
 * Features:
 * - Numbered list of actions
 * - Indentation for nested actions (IF, LOOP)
 * - Expand/collapse nested structures
 * - Drag-and-drop reordering
 * - Add action buttons between items
 * - Action summary display
 * - Quick edit inline
 * - Delete button
 * - Visual connection lines for nesting
 */

import type { Workflow, Action } from "@/lib/action-schema/action-types";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import { ActionItem } from "./_components/ActionItem";
import { AddActionButton } from "./_components/AddActionButton";
import { useSequentialListDragDrop } from "./_hooks/useSequentialListDragDrop";
import { buildActionTree } from "./utils";

// ============================================================================
// Types
// ============================================================================

export interface SequentialListViewProps {
  workflow: Workflow;
  onActionClick?: (action: Action) => void;
  onActionEdit?: (action: Action) => void;
  onActionDelete?: (actionId: string) => void;
  onActionReorder?: (fromIndex: number, toIndex: number) => void;
  onAddAction?: (afterIndex: number) => void;
  selectedActionId?: string;
  editable?: boolean;
}

// ============================================================================
// Sequential List View Component
// ============================================================================

export function SequentialListView({
  workflow,
  onActionClick,
  onActionEdit,
  onActionDelete,
  onActionReorder,
  onAddAction,
  selectedActionId,
  editable = true,
}: SequentialListViewProps) {
  const { expanded: expandedActions, toggle: handleToggleExpand } =
    useExpandableSet();

  const {
    draggedIndex,
    dropIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = useSequentialListDragDrop({ editable, onActionReorder });

  // Build action tree (flatten nested structures)
  const actionTree = buildActionTree(workflow.actions, expandedActions);

  return (
    <div className="sequential-list-view">
      <div className="list-header">
        <h3>Actions ({workflow.actions.length})</h3>
        {editable && onAddAction && (
          <button
            className="add-action-button"
            onClick={() => onAddAction(-1)}
            title="Add action at beginning"
          >
            + Add Action
          </button>
        )}
      </div>

      <div className="actions-list">
        {actionTree.map((node, index) => (
          <div key={node.action.id}>
            <ActionItem
              node={node}
              globalIndex={index}
              isSelected={selectedActionId === node.action.id}
              isDragging={draggedIndex === index}
              isDropTarget={dropIndex === index}
              editable={editable}
              onToggleExpand={handleToggleExpand}
              onClick={onActionClick}
              onEdit={onActionEdit}
              onDelete={onActionDelete}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            />
            {editable && onAddAction && (
              <AddActionButton
                onClick={() => onAddAction(index)}
                visible={dropIndex === index}
              />
            )}
          </div>
        ))}
      </div>

      {workflow.actions.length === 0 && (
        <div className="empty-list">
          <p>No actions in this workflow</p>
          {editable && onAddAction && (
            <button
              className="add-first-action-button"
              onClick={() => onAddAction(-1)}
            >
              Add First Action
            </button>
          )}
        </div>
      )}
    </div>
  );
}
