/**
 * Types for the Sequential List View component tree.
 */

import type { Action } from "@/lib/action-schema/action-types";

export interface ActionTreeNode {
  action: Action;
  index: number;
  level: number;
  children?: ActionTreeNode[];
  collapsed?: boolean;
}

export interface ActionItemProps {
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

export interface AddActionButtonProps {
  onClick: () => void;
  visible: boolean;
}
