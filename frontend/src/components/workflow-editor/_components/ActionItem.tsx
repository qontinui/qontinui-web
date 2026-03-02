/**
 * ActionItem - renders a single action row in the sequential list.
 *
 * Supports:
 * - Nesting with indent lines
 * - Drag handle (when editable)
 * - Expand/collapse for compound actions (IF, LOOP, TRY_CATCH)
 * - Inline edit and delete buttons
 * - Recursive rendering of child actions
 */

import type { ActionItemProps } from "../types";
import { getActionIcon, getActionSummary } from "../utils";

export function ActionItem({
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
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(action)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.(action);
        }
      }}
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
          {"\u22EE\u22EE"}
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
          {isExpanded ? "\u25BC" : "\u25B6"}
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
            {"\u270E"}
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
            {"\u00D7"}
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
