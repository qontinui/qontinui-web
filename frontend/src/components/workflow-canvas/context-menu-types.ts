/**
 * Context Menu Types - Shared type definitions for the context menu system
 */

import React from "react";

export interface ContextMenuItem {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
}

export interface ContextMenuProps {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  parent?: HTMLElement;
}

export type ContextMenuType = "canvas" | "node" | "edge" | "multi-select";

export interface ContextMenuState {
  type: ContextMenuType;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  nodeId?: string;
  edgeId?: string;
  selectedNodeIds?: string[];
}
