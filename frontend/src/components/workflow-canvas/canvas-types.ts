/**
 * Canvas type definitions for React Flow integration
 *
 * Defines the bridge between qontinui's workflow format and React Flow's node/edge system.
 */

import { Node, Edge, XYPosition } from "@xyflow/react";
import {
  Action,
  Connection,
  ActionType,
} from "@/lib/action-schema/action-types";

// Re-export ActionType for convenience
export type { ActionType };

// ============================================================================
// Canvas Node Types
// ============================================================================

/**
 * Custom data attached to React Flow nodes
 */
export interface CanvasNodeData {
  /** Original action from workflow */
  action: Action;

  /** Whether this node is selected */
  selected?: boolean;

  /** Whether this node is part of a multi-select */
  multiSelected?: boolean;

  /** Visual state for execution/debugging */
  executionState?: "idle" | "running" | "success" | "error" | "warning";

  /** Error message if execution failed */
  errorMessage?: string;

  /** Execution duration in milliseconds */
  executionDuration?: number;

  /** Whether this node is disabled */
  disabled?: boolean;

  /** Whether this node is highlighted (e.g., during hover) */
  highlighted?: boolean;

  /** Custom label override */
  label?: string;
}

/**
 * Canvas node wrapping an Action for React Flow
 */
export interface CanvasNode extends Omit<Node, 'data'> {
  type: string; // Node type determines rendering
  data: CanvasNodeData;
  position: XYPosition;
}

// ============================================================================
// Canvas Edge Types
// ============================================================================

/**
 * Custom data attached to React Flow edges
 */
export interface CanvasEdgeData {
  /** Original connection from workflow */
  connection: Connection;

  /** Connection type for styling */
  connectionType: "main" | "error" | "success" | "parallel";

  /** Output index from source node */
  outputIndex: number;

  /** Label for the edge (e.g., "true", "false", "error") */
  label?: string;

  /** Whether this edge is selected */
  selected?: boolean;

  /** Whether this edge is animated (flow indicator) */
  animated?: boolean;

  /** Whether this edge was recently traversed during execution */
  recentlyTraversed?: boolean;

  /** Custom styling class */
  styleClass?: string;
}

/**
 * Canvas edge wrapping a Connection for React Flow
 */
export interface CanvasEdge extends Omit<Edge, 'data'> {
  type: "custom"; // Always use custom edge component
  data: CanvasEdgeData;
  animated?: boolean;
  style?: React.CSSProperties;
}

// ============================================================================
// Canvas Viewport
// ============================================================================

/**
 * Canvas viewport state (zoom, pan position)
 */
export interface CanvasViewport {
  /** Zoom level (1 = 100%, 0.5 = 50%, 2 = 200%) */
  zoom: number;

  /** X position of viewport center */
  x: number;

  /** Y position of viewport center */
  y: number;
}

// ============================================================================
// Canvas Settings
// ============================================================================

/**
 * User preferences for canvas behavior and appearance
 */
export interface CanvasSettings {
  /** Whether to snap nodes to grid */
  snapToGrid: boolean;

  /** Grid size in pixels (for snapping) */
  gridSize: number;

  /** Whether to show grid background */
  showGrid: boolean;

  /** Whether to show minimap */
  showMinimap: boolean;

  /** Whether to show controls (zoom, fit view, etc.) */
  showControls: boolean;

  /** Whether to enable connection validation */
  validateConnections: boolean;

  /** Whether to enable keyboard shortcuts */
  keyboardShortcuts: boolean;

  /** Whether to animate flow on execution */
  animateFlow: boolean;

  /** Default zoom level */
  defaultZoom: number;

  /** Minimum zoom level */
  minZoom: number;

  /** Maximum zoom level */
  maxZoom: number;

  /** Pan on scroll (true) or zoom on scroll (false) */
  panOnScroll: boolean;

  /** Whether to enable touch/gesture support */
  touchEnabled: boolean;

  /** Whether nodes can be deleted with keyboard */
  nodesDeletable: boolean;

  /** Whether edges can be deleted with keyboard */
  edgesDeletable: boolean;

  /** Whether nodes can be selected */
  nodesSelectable: boolean;

  /** Whether edges can be selected */
  edgesSelectable: boolean;

  /** Whether to show node labels */
  showNodeLabels: boolean;

  /** Whether to show edge labels */
  showEdgeLabels: boolean;

  /** Connection line type */
  connectionLineType:
    | "default"
    | "straight"
    | "step"
    | "smoothstep"
    | "simplebezier";

  /** Default edge type */
  defaultEdgeType:
    | "default"
    | "straight"
    | "step"
    | "smoothstep"
    | "simplebezier";
}

/**
 * Default canvas settings
 */
export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  snapToGrid: true,
  gridSize: 20,
  showGrid: true,
  showMinimap: true,
  showControls: true,
  validateConnections: true,
  keyboardShortcuts: true,
  animateFlow: false,
  defaultZoom: 1,
  minZoom: 0.1,
  maxZoom: 2,
  panOnScroll: false,
  touchEnabled: true,
  nodesDeletable: true,
  edgesDeletable: true,
  nodesSelectable: true,
  edgesSelectable: true,
  showNodeLabels: true,
  showEdgeLabels: true,
  connectionLineType: "smoothstep",
  defaultEdgeType: "smoothstep",
};

// ============================================================================
// Node Categories
// ============================================================================

/**
 * Action categories for visual grouping
 */
export enum ActionCategory {
  FIND = "find",
  MOUSE = "mouse",
  KEYBOARD = "keyboard",
  CONTROL_FLOW = "control_flow",
  DATA = "data",
  STATE = "state",
}

/**
 * Map action types to categories
 */
export const ACTION_TYPE_TO_CATEGORY: Record<ActionType, ActionCategory> = {
  // Find actions
  FIND: ActionCategory.FIND,
  VANISH: ActionCategory.FIND,
  EXISTS: ActionCategory.FIND,
  WAIT: ActionCategory.FIND,

  // Mouse actions
  CLICK: ActionCategory.MOUSE,
  MOUSE_MOVE: ActionCategory.MOUSE,
  MOUSE_DOWN: ActionCategory.MOUSE,
  MOUSE_UP: ActionCategory.MOUSE,
  DRAG: ActionCategory.MOUSE,
  SCROLL: ActionCategory.MOUSE,

  // Keyboard actions
  TYPE: ActionCategory.KEYBOARD,
  KEY_PRESS: ActionCategory.KEYBOARD,
  KEY_DOWN: ActionCategory.KEYBOARD,
  KEY_UP: ActionCategory.KEYBOARD,
  HOTKEY: ActionCategory.KEYBOARD,

  // Control flow actions
  IF: ActionCategory.CONTROL_FLOW,
  LOOP: ActionCategory.CONTROL_FLOW,
  BREAK: ActionCategory.CONTROL_FLOW,
  CONTINUE: ActionCategory.CONTROL_FLOW,
  SWITCH: ActionCategory.CONTROL_FLOW,
  TRY_CATCH: ActionCategory.CONTROL_FLOW,

  // Data actions
  SET_VARIABLE: ActionCategory.DATA,
  GET_VARIABLE: ActionCategory.DATA,
  SORT: ActionCategory.DATA,
  FILTER: ActionCategory.DATA,
  MAP: ActionCategory.DATA,
  REDUCE: ActionCategory.DATA,
  STRING_OPERATION: ActionCategory.DATA,
  MATH_OPERATION: ActionCategory.DATA,

  // State actions
  GO_TO_STATE: ActionCategory.STATE,
  RUN_WORKFLOW: ActionCategory.STATE,
  SCREENSHOT: ActionCategory.STATE,

  // Code actions
  CODE_BLOCK: ActionCategory.DATA,
  CUSTOM_FUNCTION: ActionCategory.DATA,
};

/**
 * Get category for an action type
 */
export function getActionCategory(actionType: ActionType): ActionCategory {
  return ACTION_TYPE_TO_CATEGORY[actionType];
}

// ============================================================================
// Connection Validation
// ============================================================================

/**
 * Connection validation result
 */
export interface ConnectionValidationResult {
  /** Whether the connection is valid */
  valid: boolean;

  /** Error message if invalid */
  message?: string;

  /** Suggested action if invalid */
  suggestion?: string;
}

/**
 * Connection attempt (before creation)
 */
export interface ConnectionAttempt {
  /** Source node ID */
  source: string;

  /** Source handle ID (output) */
  sourceHandle: string | null;

  /** Target node ID */
  target: string;

  /** Target handle ID (input) */
  targetHandle: string | null;
}

// ============================================================================
// Canvas Events
// ============================================================================

/**
 * Event fired when a node is clicked
 */
export interface NodeClickEvent {
  node: CanvasNode;
  event: React.MouseEvent;
}

/**
 * Event fired when an edge is clicked
 */
export interface EdgeClickEvent {
  edge: CanvasEdge;
  event: React.MouseEvent;
}

/**
 * Event fired when the canvas background is clicked
 */
export interface CanvasClickEvent {
  event: React.MouseEvent;
  position: XYPosition;
}

/**
 * Event fired when nodes are dragged
 */
export interface NodeDragEvent {
  nodes: CanvasNode[];
  event: React.MouseEvent | TouchEvent;
}

/**
 * Event fired when a connection is created
 */
export interface ConnectionCreatedEvent {
  connection: Connection;
  source: CanvasNode;
  target: CanvasNode;
}

// ============================================================================
// Node Type Registry
// ============================================================================

/**
 * Node type for React Flow
 * Maps action categories to React Flow node types
 */
export const NODE_TYPES = {
  default: "default",
  find: "find",
  mouse: "mouse",
  keyboard: "keyboard",
  control_flow: "control_flow",
  data: "data",
  state: "state",
} as const;

export type NodeTypeKey = keyof typeof NODE_TYPES;

/**
 * Get React Flow node type for an action
 *
 * For control flow nodes with custom components (IF, LOOP, SWITCH, TRY_CATCH, BREAK, CONTINUE),
 * returns the specific ActionType so React Flow uses the correct component.
 * For other actions, returns the category-based node type.
 */
export function getNodeType(action: Action): string {
  // Control flow nodes need specific components for proper handle IDs
  const controlFlowActions = [
    "IF",
    "LOOP",
    "SWITCH",
    "TRY_CATCH",
    "BREAK",
    "CONTINUE",
  ];
  if (controlFlowActions.includes(action.type)) {
    return action.type; // Return 'TRY_CATCH', 'IF', etc.
  }

  // For all other actions, use category-based node type
  const category = getActionCategory(action.type);
  return NODE_TYPES[category] || NODE_TYPES.default;
}

// ============================================================================
// Handle Positions
// ============================================================================

/**
 * Handle position on a node
 */
export type HandlePosition = "top" | "right" | "bottom" | "left";

/**
 * Handle definition for inputs/outputs
 */
export interface HandleDefinition {
  id: string;
  type: "source" | "target";
  position: HandlePosition;
  label?: string;
}
