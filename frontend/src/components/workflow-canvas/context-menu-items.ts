/**
 * Context Menu Item Builders - Pure functions that build menu item arrays
 * for each context menu type (canvas, node, edge, multi-select)
 */

import { icons } from "./context-menu-icons";
import type { ContextMenuItem } from "./context-menu-types";

// ============================================================================
// Canvas Store Actions Interface
// ============================================================================

export interface CanvasMenuActions {
  clipboardNodes: unknown[];
  paste: (position: { x: number; y: number }) => void;
  selectAll: () => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  copy: () => void;
  cut: () => void;
  duplicate: () => void;
  deleteActions: (ids: string[]) => void;
}

// ============================================================================
// Canvas Menu Items
// ============================================================================

export function buildCanvasMenuItems(
  position: { x: number; y: number },
  actions: Pick<
    CanvasMenuActions,
    "clipboardNodes" | "paste" | "selectAll" | "toggleGrid" | "toggleSnapToGrid"
  >
): ContextMenuItem[] {
  return [
    {
      label: "Add Node",
      icon: icons.add,
      submenu: [
        {
          label: "Find Actions",
          icon: icons.select,
          submenu: [
            { label: "Find", onClick: () => {} },
            {
              label: "Find State",
              onClick: () => {},
            },
            { label: "Vanish", onClick: () => {} },
            { label: "Exists", onClick: () => {} },
            { label: "Wait", onClick: () => {} },
          ],
        },
        {
          label: "Mouse Actions",
          icon: icons.select,
          submenu: [
            { label: "Click", onClick: () => {} },
            {
              label: "Double Click",
              onClick: () => {},
            },
            {
              label: "Right Click",
              onClick: () => {},
            },
            { label: "Drag", onClick: () => {} },
          ],
        },
        {
          label: "Keyboard Actions",
          icon: icons.select,
          submenu: [
            { label: "Type", onClick: () => {} },
            {
              label: "Key Press",
              onClick: () => {},
            },
            { label: "Hotkey", onClick: () => {} },
          ],
        },
        {
          label: "Control Flow",
          icon: icons.select,
          submenu: [
            { label: "If", onClick: () => {} },
            { label: "Loop", onClick: () => {} },
            { label: "Switch", onClick: () => {} },
          ],
        },
      ],
    },
    {
      label: "Paste",
      icon: icons.paste,
      shortcut: "Ctrl+V",
      onClick: () => actions.paste(position),
      disabled: actions.clipboardNodes.length === 0,
    },
    { divider: true },
    {
      label: "Select All",
      icon: icons.select,
      shortcut: "Ctrl+A",
      onClick: actions.selectAll,
    },
    {
      label: "Fit View",
      icon: icons.fitView,
      shortcut: "Ctrl+F",
      onClick: () => {},
    },
    {
      label: "Auto Layout",
      icon: icons.layout,
      shortcut: "Ctrl+L",
      onClick: () => {},
    },
    { divider: true },
    {
      label: "Grid Settings",
      icon: icons.grid,
      submenu: [
        {
          label: "Show Grid",
          onClick: actions.toggleGrid,
        },
        {
          label: "Snap to Grid",
          onClick: actions.toggleSnapToGrid,
        },
        { divider: true },
        {
          label: "Grid Size: 10px",
          onClick: () => {},
        },
        {
          label: "Grid Size: 20px",
          onClick: () => {},
        },
        {
          label: "Grid Size: 25px",
          onClick: () => {},
        },
      ],
    },
  ];
}

// ============================================================================
// Node Menu Items
// ============================================================================

export function buildNodeMenuItems(
  nodeId: string,
  actions: Pick<
    CanvasMenuActions,
    "copy" | "cut" | "duplicate" | "deleteActions"
  >
): ContextMenuItem[] {
  return [
    {
      label: "Edit Properties",
      icon: icons.edit,
      shortcut: "Enter",
      onClick: () => {},
    },
    { divider: true },
    {
      label: "Duplicate",
      icon: icons.duplicate,
      shortcut: "Ctrl+D",
      onClick: actions.duplicate,
    },
    {
      label: "Copy",
      icon: icons.copy,
      shortcut: "Ctrl+C",
      onClick: actions.copy,
    },
    {
      label: "Cut",
      icon: icons.cut,
      shortcut: "Ctrl+X",
      onClick: actions.cut,
    },
    { divider: true },
    {
      label: "Enable/Disable",
      icon: icons.disable,
      onClick: () => {},
    },
    {
      label: "Add to Favorites",
      icon: icons.star,
      onClick: () => {},
    },
    {
      label: "Create Snapshot",
      icon: icons.snapshot,
      onClick: () => {},
    },
    {
      label: "Add Comment",
      icon: icons.comment,
      onClick: () => {},
    },
    { divider: true },
    {
      label: "Delete",
      icon: icons.delete,
      shortcut: "Del",
      onClick: () => actions.deleteActions([nodeId]),
      danger: true,
    },
  ];
}

// ============================================================================
// Edge Menu Items
// ============================================================================

export function buildEdgeMenuItems(_edgeId: string): ContextMenuItem[] {
  return [
    {
      label: "Edit Connection",
      icon: icons.edit,
      onClick: () => {},
    },
    {
      label: "Add Intermediate Node",
      icon: icons.add,
      onClick: () => {},
    },
    {
      label: "Change Connection Type",
      icon: icons.connection,
      submenu: [
        { label: "Main Flow", onClick: () => {} },
        {
          label: "Error Handling",
          onClick: () => {},
        },
        {
          label: "Success Condition",
          onClick: () => {},
        },
        {
          label: "Parallel Execution",
          onClick: () => {},
        },
      ],
    },
    { divider: true },
    {
      label: "Delete Connection",
      icon: icons.delete,
      shortcut: "Del",
      onClick: () => {},
      danger: true,
    },
  ];
}

// ============================================================================
// Multi-Select Menu Items
// ============================================================================

export function buildMultiSelectMenuItems(
  nodeIds: string[],
  actions: Pick<CanvasMenuActions, "copy" | "duplicate" | "deleteActions">
): ContextMenuItem[] {
  return [
    {
      label: "Align",
      icon: icons.align,
      submenu: [
        { label: "Align Left", onClick: () => {} },
        { label: "Align Right", onClick: () => {} },
        { label: "Align Top", onClick: () => {} },
        {
          label: "Align Bottom",
          onClick: () => {},
        },
        {
          label: "Align Center Horizontal",
          onClick: () => {},
        },
        {
          label: "Align Center Vertical",
          onClick: () => {},
        },
      ],
    },
    {
      label: "Distribute",
      icon: icons.distribute,
      submenu: [
        {
          label: "Distribute Horizontally",
          onClick: () => {},
        },
        {
          label: "Distribute Vertically",
          onClick: () => {},
        },
        {
          label: "Distribute Evenly",
          onClick: () => {},
        },
      ],
    },
    {
      label: "Group",
      icon: icons.group,
      onClick: () => {},
    },
    { divider: true },
    {
      label: "Copy All",
      icon: icons.copy,
      shortcut: "Ctrl+C",
      onClick: actions.copy,
    },
    {
      label: "Duplicate All",
      icon: icons.duplicate,
      shortcut: "Ctrl+D",
      onClick: actions.duplicate,
    },
    { divider: true },
    {
      label: `Delete All (${nodeIds.length})`,
      icon: icons.delete,
      shortcut: "Del",
      onClick: () => actions.deleteActions(nodeIds),
      danger: true,
    },
  ];
}
