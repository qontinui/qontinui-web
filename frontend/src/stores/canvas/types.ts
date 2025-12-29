/**
 * Shared types for Canvas Store slices
 */

import type {
  Workflow,
  Action,
  Connection,
  Connections,
} from "../../lib/action-schema/action-types";

// ============================================================================
// Core Types
// ============================================================================

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ValidationError {
  id: string;
  actionId?: string;
  type:
    | "connection"
    | "cycle"
    | "orphaned"
    | "missing_connection"
    | "invalid_config";
  severity: "error" | "warning";
  message: string;
  details?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface HistoryState {
  workflow: Workflow;
  timestamp: number;
  description?: string;
}

// ============================================================================
// Slice State Interfaces
// ============================================================================

export interface WorkflowState {
  workflow: Workflow | null;
  isDirty: boolean;
  validationResult: ValidationResult | null;
  isValidating: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Actions are stored in workflow.actions; this slice manages CRUD operations only
export interface ActionState {}

export interface ConnectionState {
  isConnecting: boolean;
  connectingFrom: {
    actionId: string;
    outputType: string;
    outputIndex: number;
  } | null;
}

export interface SelectionState {
  selectedNodes: string[];
  selectedEdges: string[];
}

export interface ClipboardState {
  clipboardNodes: Action[];
  clipboardConnections: Connections;
}

export interface HistorySliceState {
  history: HistoryState[];
  historyIndex: number;
  maxHistorySize: number;
}

export interface ViewportState {
  viewport: Viewport;
  isDragging: boolean;
  isPanning: boolean;
}

export interface PreferencesState {
  showMinimap: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

// ============================================================================
// Slice Action Interfaces
// ============================================================================

export interface WorkflowActions {
  setWorkflow: (workflow: Workflow) => void;
  clearWorkflow: () => void;
  validateWorkflow: () => ValidationResult;
  clearValidation: () => void;
}

export interface ActionActions {
  addAction: (action: Action) => void;
  updateAction: (actionId: string, updates: Partial<Action>) => void;
  deleteAction: (actionId: string) => void;
  deleteActions: (actionIds: string[]) => void;
  duplicateAction: (
    actionId: string,
    offset?: { x: number; y: number }
  ) => void;
  moveAction: (actionId: string, position: [number, number]) => void;
  moveActions: (
    updates: { actionId: string; position: [number, number] }[]
  ) => void;
  getActionById: (actionId: string) => Action | undefined;
  findActionsByType: (type: string) => Action[];
}

export interface ConnectionActions {
  addConnection: (
    sourceId: string,
    outputType: "main" | "error" | "success" | "parallel",
    outputIndex: number,
    targetId: string,
    targetIndex: number
  ) => void;
  deleteConnection: (
    sourceId: string,
    outputType: string,
    outputIndex: number,
    targetId: string
  ) => void;
  deleteConnectionsForAction: (actionId: string) => void;
  startConnecting: (
    actionId: string,
    outputType: string,
    outputIndex: number
  ) => void;
  finishConnecting: (targetId: string, targetIndex: number) => void;
  cancelConnecting: () => void;
  getConnectionsForAction: (actionId: string) => Connection[];
}

export interface SelectionActions {
  selectNode: (nodeId: string, multi?: boolean) => void;
  selectNodes: (nodeIds: string[], multi?: boolean) => void;
  selectEdge: (edgeId: string, multi?: boolean) => void;
  clearSelection: () => void;
  selectAll: () => void;
  invertSelection: () => void;
}

export interface ClipboardActions {
  copy: () => void;
  paste: (position?: { x: number; y: number }) => void;
  cut: () => void;
  duplicate: () => void;
}

export interface HistoryActions {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  recordHistory: (description?: string) => void;
  clearHistory: () => void;
}

export interface ViewportActions {
  setViewport: (viewport: Partial<Viewport>) => void;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setDragging: (isDragging: boolean) => void;
  setPanning: (isPanning: boolean) => void;
}

export interface PreferencesActions {
  toggleMinimap: () => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;
}

// ============================================================================
// Combined Types
// ============================================================================

export type WorkflowSlice = WorkflowState & WorkflowActions;
export type ActionSlice = ActionState & ActionActions;
export type ConnectionSlice = ConnectionState & ConnectionActions;
export type SelectionSlice = SelectionState & SelectionActions;
export type ClipboardSlice = ClipboardState & ClipboardActions;
export type HistorySlice = HistorySliceState & HistoryActions;
export type ViewportSlice = ViewportState & ViewportActions;
export type PreferencesSlice = PreferencesState & PreferencesActions;

export type CanvasStore = WorkflowSlice &
  ActionSlice &
  ConnectionSlice &
  SelectionSlice &
  ClipboardSlice &
  HistorySlice &
  ViewportSlice &
  PreferencesSlice;

// ============================================================================
// Utility Types
// ============================================================================

export interface ActionUpdate {
  actionId: string;
  position: [number, number];
}

export { Workflow, Action, Connection, Connections };
