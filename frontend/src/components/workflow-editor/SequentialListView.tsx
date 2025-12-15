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

import React, { useState } from "react";
import type { Workflow, Action } from "@/lib/action-schema/action-types";

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

interface ActionTreeNode {
  action: Action;
  index: number;
  level: number;
  children?: ActionTreeNode[];
  collapsed?: boolean;
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
  const [expandedActions, setExpandedActions] = useState<Set<string>>(
    new Set()
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Build action tree (flatten nested structures)
  const actionTree = buildActionTree(workflow.actions, expandedActions);

  const handleToggleExpand = (actionId: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!editable) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!editable) return;
    e.preventDefault();
    setDropIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    if (!editable || draggedIndex === null) return;
    e.preventDefault();

    if (draggedIndex !== index && onActionReorder) {
      onActionReorder(draggedIndex, index);
    }

    setDraggedIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

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
          <React.Fragment key={node.action.id}>
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
          </React.Fragment>
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

// ============================================================================
// Action Item Component
// ============================================================================

interface ActionItemProps {
  node: ActionTreeNode;
  globalIndex: number;
  isSelected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  editable: boolean;
  onToggleExpand: (actionId: string) => void;
  onClick?: (action: Action) => void;
  onEdit?: (action: Action) => void;
  onDelete?: (actionId: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function ActionItem({
  node,
  globalIndex,
  isSelected,
  isDragging,
  isDropTarget,
  editable,
  onToggleExpand,
  onClick,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ActionItemProps) {
  const { action, level, children } = node;
  const hasChildren = children && children.length > 0;
  const isExpanded = !node.collapsed;

  const indentWidth = level * 24;

  return (
    <div
      className={`action-item ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`}
      style={{ paddingLeft: `${indentWidth + 16}px` }}
      draggable={editable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => onClick?.(action)}
    >
      {/* Indent Lines */}
      {level > 0 && (
        <div className="indent-lines">
          {Array.from({ length: level }).map((_, i) => (
            <div
              key={i}
              className="indent-line"
              style={{ left: `${i * 24 + 8}px` }}
            />
          ))}
        </div>
      )}

      {/* Drag Handle */}
      {editable && (
        <div className="drag-handle" title="Drag to reorder">
          ⋮⋮
        </div>
      )}

      {/* Number */}
      <div className="action-number">{globalIndex + 1}.</div>

      {/* Expand/Collapse */}
      {hasChildren && (
        <button
          className="expand-button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(action.id);
          }}
        >
          {isExpanded ? "▼" : "▶"}
        </button>
      )}

      {/* Type Badge */}
      <div className={`action-type-badge type-${action.type.toLowerCase()}`}>
        {getActionIcon(action.type)} {action.type}
      </div>

      {/* Summary */}
      <div className="action-summary">{getActionSummary(action)}</div>

      {/* Actions */}
      {editable && (
        <div className="action-buttons">
          <button
            className="edit-button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(action);
            }}
            title="Edit action"
          >
            ✎
          </button>
          <button
            className="delete-button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete ${action.type} action?`)) {
                onDelete?.(action.id);
              }
            }}
            title="Delete action"
          >
            ×
          </button>
        </div>
      )}

      {/* Nested Children */}
      {hasChildren && isExpanded && (
        <div className="nested-actions">
          {children.map((childNode, i) => (
            <ActionItem
              key={childNode.action.id}
              node={childNode}
              globalIndex={globalIndex + i + 1}
              isSelected={false}
              isDragging={false}
              isDropTarget={false}
              editable={editable}
              onToggleExpand={onToggleExpand}
              onClick={onClick}
              onEdit={onEdit}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Add Action Button Component
// ============================================================================

interface AddActionButtonProps {
  onClick: () => void;
  visible: boolean;
}

function AddActionButton({ onClick, visible }: AddActionButtonProps) {
  return (
    <div className={`add-action-divider ${visible ? "visible" : ""}`}>
      <button className="add-action-inline-button" onClick={onClick}>
        + Add Action
      </button>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildActionTree(
  actions: Action[],
  expandedActions: Set<string>
): ActionTreeNode[] {
  const tree: ActionTreeNode[] = [];
  let index = 0;

  function processAction(action: Action, level: number): ActionTreeNode {
    const node: ActionTreeNode = {
      action,
      index: index++,
      level,
      collapsed: !expandedActions.has(action.id),
    };

    // Check for nested actions
    if (action.type === "IF") {
      const ifConfig = action.config as unknown;
      const children: ActionTreeNode[] = [];

      // Then branch
      if (ifConfig.thenActions && Array.isArray(ifConfig.thenActions)) {
        children.push(
          ...ifConfig.thenActions.map((a: Action) =>
            processAction(a, level + 1)
          )
        );
      }

      // Else branch
      if (ifConfig.elseActions && Array.isArray(ifConfig.elseActions)) {
        children.push(
          ...ifConfig.elseActions.map((a: Action) =>
            processAction(a, level + 1)
          )
        );
      }

      if (children.length > 0) {
        node.children = children;
      }
    } else if (action.type === "LOOP") {
      const loopConfig = action.config as unknown;
      if (loopConfig.loopActions && Array.isArray(loopConfig.loopActions)) {
        node.children = loopConfig.loopActions.map((a: Action) =>
          processAction(a, level + 1)
        );
      }
    } else if (action.type === "TRY_CATCH") {
      const tryConfig = action.config as unknown;
      const children: ActionTreeNode[] = [];

      if (tryConfig.tryActions && Array.isArray(tryConfig.tryActions)) {
        children.push(
          ...tryConfig.tryActions.map((a: Action) =>
            processAction(a, level + 1)
          )
        );
      }

      if (tryConfig.catchActions && Array.isArray(tryConfig.catchActions)) {
        children.push(
          ...tryConfig.catchActions.map((a: Action) =>
            processAction(a, level + 1)
          )
        );
      }

      if (children.length > 0) {
        node.children = children;
      }
    }

    return node;
  }

  for (const action of actions) {
    tree.push(processAction(action, 0));
  }

  return tree;
}

function getActionIcon(type: string): string {
  const icons: Record<string, string> = {
    CLICK: "🖱️",
    TYPE: "⌨️",
    WAIT: "⏱️",
    SCREENSHOT: "📷",
    IF: "🔀",
    LOOP: "🔁",
    TRY_CATCH: "⚠️",
    SWITCH: "🔀",
    EXISTS: "🔍",
    FIND: "🔍",
    RAG_FIND: "🔮",
    GET_VARIABLE: "📥",
    SET_VARIABLE: "📤",
    FILTER: "🔽",
    MAP: "🗺️",
    REDUCE: "⚙️",
  };
  return icons[type] || "•";
}

function getActionSummary(action: Action): string {
  if (action.name) {
    return action.name;
  }

  // Generate summary based on action type and config
  const config = action.config as unknown;

  switch (action.type) {
    case "CLICK":
      if (config.target?.image) {
        return `Click "${config.target.image}"`;
      } else if (config.target?.selector) {
        return `Click "${config.target.selector}"`;
      }
      return "Click element";

    case "TYPE":
      if (config.text) {
        const truncated =
          config.text.length > 30
            ? config.text.substring(0, 30) + "..."
            : config.text;
        return `Type "${truncated}"`;
      }
      return "Type text";

    case "WAIT":
      if (config.duration) {
        return `Wait ${config.duration}ms`;
      }
      return "Wait";

    case "SCREENSHOT":
      return config.filename
        ? `Screenshot "${config.filename}"`
        : "Take screenshot";

    case "IF":
      return "If condition";

    case "LOOP":
      return config.iterations ? `Loop ${config.iterations} times` : "Loop";

    case "TRY_CATCH":
      return "Try-Catch block";

    case "EXISTS":
      return "Check if exists";

    case "FIND":
      return "Find element";

    case "RAG_FIND":
      return "RAG Find element";

    case "GET_VARIABLE":
      return config.variable ? `Get "${config.variable}"` : "Get variable";

    case "SET_VARIABLE":
      return config.variable ? `Set "${config.variable}"` : "Set variable";

    case "FILTER":
      return "Filter data";

    case "MAP":
      return "Map/Transform data";

    case "REDUCE":
      return "Reduce data";

    default:
      return action.type;
  }
}
