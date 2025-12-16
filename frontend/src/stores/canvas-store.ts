/**
 * Canvas Store - Zustand state management for the workflow canvas
 *
 * This store manages the entire state of the canvas editor including:
 * - Workflow data (actions, connections)
 * - Selection state (nodes, edges)
 * - Viewport state (pan, zoom)
 * - Editing state (dragging, connecting)
 * - History (undo/redo)
 * - Clipboard operations
 *
 * Performance optimizations:
 * - Immer for immutable updates
 * - Memoized selectors
 * - Debounced history recording
 * - Selective re-renders
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  Workflow,
  Action,
  Connection,
  Connections,
} from "../lib/action-schema/action-types";

// ============================================================================
// Helper Type Guards
// ============================================================================

type ConnectionType = "main" | "error" | "success" | "parallel";

function isValidConnectionType(type: string): type is ConnectionType {
  return (
    type === "main" ||
    type === "error" ||
    type === "success" ||
    type === "parallel"
  );
}

// ============================================================================
// Types
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

export interface CanvasState {
  // Workflow data
  workflow: Workflow | null;
  isDirty: boolean;

  // Canvas state
  selectedNodes: string[];
  selectedEdges: string[];
  viewport: Viewport;

  // Editing state
  isDragging: boolean;
  isConnecting: boolean;
  isPanning: boolean;
  connectingFrom: {
    actionId: string;
    outputType: string;
    outputIndex: number;
  } | null;

  // Clipboard
  clipboardNodes: Action[];
  clipboardConnections: Connections;

  // History (undo/redo)
  history: HistoryState[];
  historyIndex: number;
  maxHistorySize: number;

  // Validation
  validationResult: ValidationResult | null;
  isValidating: boolean;

  // UI state
  showMinimap: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

export interface CanvasActions {
  // Workflow management
  setWorkflow: (workflow: Workflow) => void;
  clearWorkflow: () => void;

  // Action CRUD
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

  // Connection management
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

  // Selection
  selectNode: (nodeId: string, multi?: boolean) => void;
  selectNodes: (nodeIds: string[], multi?: boolean) => void;
  selectEdge: (edgeId: string, multi?: boolean) => void;
  clearSelection: () => void;
  selectAll: () => void;
  invertSelection: () => void;

  // Clipboard
  copy: () => void;
  paste: (position?: { x: number; y: number }) => void;
  cut: () => void;
  duplicate: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  recordHistory: (description?: string) => void;
  clearHistory: () => void;

  // Viewport
  setViewport: (viewport: Partial<Viewport>) => void;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // Editing state
  setDragging: (isDragging: boolean) => void;
  setPanning: (isPanning: boolean) => void;

  // Validation
  validateWorkflow: () => ValidationResult;
  clearValidation: () => void;

  // UI settings
  toggleMinimap: () => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;

  // Utility
  getActionById: (actionId: string) => Action | undefined;
  getConnectionsForAction: (actionId: string) => Connection[];
  findActionsByType: (type: string) => Action[];
}

export type CanvasStore = CanvasState & CanvasActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: CanvasState = {
  workflow: null,
  isDirty: false,

  selectedNodes: [],
  selectedEdges: [],
  viewport: { x: 0, y: 0, zoom: 1 },

  isDragging: false,
  isConnecting: false,
  isPanning: false,
  connectingFrom: null,

  clipboardNodes: [],
  clipboardConnections: {},

  history: [],
  historyIndex: -1,
  maxHistorySize: 50,

  validationResult: null,
  isValidating: false,

  showMinimap: true,
  showGrid: true,
  snapToGrid: true,
  gridSize: 20,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID for actions
 */
function generateActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Deep clone an action with a new ID
 */
function cloneAction(
  action: Action,
  offset: { x: number; y: number } = { x: 0, y: 0 }
): Action {
  return {
    ...action,
    id: generateActionId(),
    position: [action.position[0] + offset.x, action.position[1] + offset.y],
  };
}

/**
 * Update connections when actions are cloned
 */
function updateConnectionsForClonedActions(
  connections: Connections,
  oldToNewIdMap: Map<string, string>
): Connections {
  const newConnections: Connections = {};

  for (const [sourceId, connectionTypes] of Object.entries(connections)) {
    const newSourceId = oldToNewIdMap.get(sourceId) || sourceId;

    newConnections[newSourceId] = {};

    for (const [type, outputs] of Object.entries(connectionTypes)) {
      if (outputs && Array.isArray(outputs) && isValidConnectionType(type)) {
        (newConnections[newSourceId] as Record<string, unknown>)[type] =
          outputs.map((outputConnections) =>
            outputConnections.map((conn) => ({
              ...conn,
              action: oldToNewIdMap.get(conn.action) || conn.action,
            }))
          );
      }
    }
  }

  return newConnections;
}

// ============================================================================
// Store
// ============================================================================

export const useCanvasStore = create<CanvasStore>()(
  devtools(
    immer(
      persist(
        (set, get) => ({
          ...initialState,

          // ========================================================================
          // Workflow Management
          // ========================================================================

          setWorkflow: (workflow: Workflow) => {
            set({
              workflow,
              isDirty: false,
              selectedNodes: [],
              selectedEdges: [],
              history: [],
              historyIndex: -1,
              validationResult: null,
            });
            get().recordHistory("Load workflow");
          },

          clearWorkflow: () => {
            set({
              workflow: null,
              isDirty: false,
              selectedNodes: [],
              selectedEdges: [],
              history: [],
              historyIndex: -1,
              validationResult: null,
            });
          },

          // ========================================================================
          // Action CRUD
          // ========================================================================

          addAction: (action: Action) => {
            set((state) => {
              if (!state.workflow) return;

              state.workflow.actions.push(action);
              state.isDirty = true;
            });
            get().recordHistory(`Add action: ${action.type}`);
          },

          updateAction: (actionId: string, updates: Partial<Action>) => {
            set((state) => {
              if (!state.workflow) return;

              const index = state.workflow.actions.findIndex(
                (a) => a.id === actionId
              );
              if (index !== -1) {
                state.workflow.actions[index] = {
                  ...state.workflow.actions[index],
                  ...updates,
                } as Action;
                state.isDirty = true;
              }
            });
            get().recordHistory(`Update action: ${actionId}`);
          },

          deleteAction: (actionId: string) => {
            set((state) => {
              if (!state.workflow) return;

              // Remove action
              state.workflow.actions = state.workflow.actions.filter(
                (a) => a.id !== actionId
              );

              // Remove connections
              delete state.workflow.connections[actionId];

              // Remove connections TO this action
              for (const sourceId of Object.keys(state.workflow.connections)) {
                const sourceConnections = state.workflow.connections[sourceId];
                if (!sourceConnections) continue;

                for (const type of Object.keys(sourceConnections)) {
                  if (isValidConnectionType(type)) {
                    const outputs = (sourceConnections as Record<string, unknown>)[type];
                    if (outputs && Array.isArray(outputs)) {
                      const filteredOutputs = outputs.map(
                        (conns: Connection[]) =>
                          conns.filter(
                            (conn: Connection) => conn.action !== actionId
                          )
                      );
                      (sourceConnections as Record<string, unknown>)[type] = filteredOutputs;
                    }
                  }
                }
              }

              // Remove from selection
              state.selectedNodes = state.selectedNodes.filter(
                (id) => id !== actionId
              );
              state.isDirty = true;
            });
            get().recordHistory(`Delete action: ${actionId}`);
          },

          deleteActions: (actionIds: string[]) => {
            set((state) => {
              if (!state.workflow) return;

              const idsSet = new Set(actionIds);

              // Remove actions
              state.workflow.actions = state.workflow.actions.filter(
                (a) => !idsSet.has(a.id)
              );

              // Remove connections
              for (const actionId of actionIds) {
                delete state.workflow.connections[actionId];
              }

              // Remove connections TO these actions
              for (const sourceId of Object.keys(state.workflow.connections)) {
                const sourceConnections = state.workflow.connections[sourceId];
                if (!sourceConnections) continue;

                for (const type of Object.keys(sourceConnections)) {
                  if (isValidConnectionType(type)) {
                    const outputs = (sourceConnections as Record<string, unknown>)[type];
                    if (outputs && Array.isArray(outputs)) {
                      const filteredOutputs = outputs.map(
                        (conns: Connection[]) =>
                          conns.filter(
                            (conn: Connection) => !idsSet.has(conn.action)
                          )
                      );
                      (sourceConnections as Record<string, unknown>)[type] = filteredOutputs;
                    }
                  }
                }
              }

              // Clear selection
              state.selectedNodes = state.selectedNodes.filter(
                (id) => !idsSet.has(id)
              );
              state.isDirty = true;
            });
            get().recordHistory(`Delete ${actionIds.length} actions`);
          },

          duplicateAction: (actionId: string, offset = { x: 50, y: 50 }) => {
            const action = get().getActionById(actionId);
            if (!action) return;

            const newAction = cloneAction(action, offset);
            get().addAction(newAction);
            get().selectNode(newAction.id, false);
          },

          moveAction: (actionId: string, position: [number, number]) => {
            get().updateAction(actionId, { position });
          },

          moveActions: (
            updates: { actionId: string; position: [number, number] }[]
          ) => {
            set((state) => {
              if (!state.workflow) return;

              for (const { actionId, position } of updates) {
                const index = state.workflow.actions.findIndex(
                  (a) => a.id === actionId
                );
                if (index !== -1) {
                  const action = state.workflow.actions[index];
                  if (action) {
                    action.position = position;
                  }
                }
              }
              state.isDirty = true;
            });
            get().recordHistory(`Move ${updates.length} actions`);
          },

          // ========================================================================
          // Connection Management
          // ========================================================================

          addConnection: (
            sourceId: string,
            outputType: "main" | "error" | "success" | "parallel",
            outputIndex: number,
            targetId: string,
            targetIndex: number
          ) => {
            set((state) => {
              if (!state.workflow) return;

              // Initialize connections for source if needed
              if (!state.workflow.connections[sourceId]) {
                state.workflow.connections[sourceId] = {};
              }

              const sourceConns = state.workflow.connections[sourceId];
              if (!sourceConns) return;

              if (!isValidConnectionType(outputType)) {
                return;
              }

              if (!(sourceConns as Record<string, unknown>)[outputType]) {
                (sourceConns as Record<string, unknown>)[outputType] = [];
              }

              const outputArray = (sourceConns as Record<string, unknown>)[outputType];
              if (!outputArray || !Array.isArray(outputArray)) return;

              // Ensure output index array exists
              while (outputArray.length <= outputIndex) {
                outputArray.push([]);
              }

              // Add connection
              const connection: Connection = {
                action: targetId,
                type: outputType,
                index: targetIndex,
              };

              const targetArray = outputArray[outputIndex];
              if (targetArray && Array.isArray(targetArray)) {
                targetArray.push(connection);
              }
              state.isDirty = true;
            });
            get().recordHistory("Add connection");
          },

          deleteConnection: (
            sourceId: string,
            outputType: string,
            outputIndex: number,
            targetId: string
          ) => {
            set((state) => {
              const sourceConns = state.workflow?.connections[sourceId];
              if (!sourceConns) return;

              if (!isValidConnectionType(outputType)) {
                return;
              }

              const outputs = (sourceConns as Record<string, unknown>)[outputType];
              if (!outputs || !Array.isArray(outputs)) return;

              const targetOutputs = outputs[outputIndex];
              if (targetOutputs && Array.isArray(targetOutputs)) {
                const filtered = targetOutputs.filter(
                  (conn: Connection) => conn.action !== targetId
                );
                outputs[outputIndex] = filtered;
              }

              state.isDirty = true;
            });
            get().recordHistory("Delete connection");
          },

          deleteConnectionsForAction: (actionId: string) => {
            set((state) => {
              if (!state.workflow) return;

              delete state.workflow.connections[actionId];
              state.isDirty = true;
            });
          },

          startConnecting: (
            actionId: string,
            outputType: string,
            outputIndex: number
          ) => {
            set((state) => {
              state.isConnecting = true;
              state.connectingFrom = { actionId, outputType, outputIndex };
            });
          },

          finishConnecting: (targetId: string, targetIndex: number) => {
            const { connectingFrom } = get();
            if (!connectingFrom) return;

            get().addConnection(
              connectingFrom.actionId,
              connectingFrom.outputType as
                | "main"
                | "error"
                | "success"
                | "parallel",
              connectingFrom.outputIndex,
              targetId,
              targetIndex
            );

            get().cancelConnecting();
          },

          cancelConnecting: () => {
            set((state) => {
              state.isConnecting = false;
              state.connectingFrom = null;
            });
          },

          // ========================================================================
          // Selection
          // ========================================================================

          selectNode: (nodeId: string, multi = false) => {
            set((state) => {
              if (multi) {
                if (state.selectedNodes.includes(nodeId)) {
                  state.selectedNodes = state.selectedNodes.filter(
                    (id) => id !== nodeId
                  );
                } else {
                  state.selectedNodes.push(nodeId);
                }
              } else {
                state.selectedNodes = [nodeId];
              }
              state.selectedEdges = [];
            });
          },

          selectNodes: (nodeIds: string[], multi = false) => {
            set((state) => {
              state.selectedNodes = multi
                ? [...new Set([...state.selectedNodes, ...nodeIds])]
                : nodeIds;
              state.selectedEdges = [];
            });
          },

          selectEdge: (edgeId: string, multi = false) => {
            set((state) => {
              if (multi) {
                if (state.selectedEdges.includes(edgeId)) {
                  state.selectedEdges = state.selectedEdges.filter(
                    (id) => id !== edgeId
                  );
                } else {
                  state.selectedEdges.push(edgeId);
                }
              } else {
                state.selectedEdges = [edgeId];
              }
              state.selectedNodes = [];
            });
          },

          clearSelection: () => {
            set((state) => {
              state.selectedNodes = [];
              state.selectedEdges = [];
            });
          },

          selectAll: () => {
            set((state) => {
              if (!state.workflow) return;
              state.selectedNodes = state.workflow.actions.map((a) => a.id);
              state.selectedEdges = [];
            });
          },

          invertSelection: () => {
            set((state) => {
              if (!state.workflow) return;

              const allNodeIds = new Set(
                state.workflow.actions.map((a) => a.id)
              );
              const currentSelection = new Set(state.selectedNodes);

              state.selectedNodes = Array.from(allNodeIds).filter(
                (id) => !currentSelection.has(id)
              );
            });
          },

          // ========================================================================
          // Clipboard
          // ========================================================================

          copy: () => {
            const { workflow, selectedNodes } = get();
            if (!workflow || selectedNodes.length === 0) return;

            const selectedSet = new Set(selectedNodes);
            const nodesToCopy = workflow.actions.filter((a) =>
              selectedSet.has(a.id)
            );

            // Copy connections between selected nodes
            const connectionsToCopy: Connections = {};
            for (const nodeId of selectedNodes) {
              const connections = workflow.connections[nodeId];
              if (!connections) continue;

              connectionsToCopy[nodeId] = {};

              for (const [type, outputs] of Object.entries(connections)) {
                if (
                  outputs &&
                  Array.isArray(outputs) &&
                  isValidConnectionType(type)
                ) {
                  (connectionsToCopy[nodeId] as Record<string, unknown>)[type] =
                    outputs.map(
                    (outputConns: Connection[]) =>
                      outputConns.filter((conn: Connection) =>
                        selectedSet.has(conn.action)
                      )
                  );
                }
              }
            }

            set((state) => {
              state.clipboardNodes = nodesToCopy;
              state.clipboardConnections = connectionsToCopy;
            });
          },

          paste: (position?: { x: number; y: number }) => {
            const { workflow, clipboardNodes, clipboardConnections } = get();
            if (!workflow || clipboardNodes.length === 0) return;

            // Calculate offset
            let offset = { x: 50, y: 50 };
            if (position && clipboardNodes.length > 0) {
              const firstNode = clipboardNodes[0];
              if (firstNode) {
                offset = {
                  x: position.x - firstNode.position[0],
                  y: position.y - firstNode.position[1],
                };
              }
            }

            // Clone actions with new IDs
            const oldToNewIdMap = new Map<string, string>();
            const newActions = clipboardNodes.map((action) => {
              const newAction = cloneAction(action, offset);
              oldToNewIdMap.set(action.id, newAction.id);
              return newAction;
            });

            // Update connections
            const newConnections = updateConnectionsForClonedActions(
              clipboardConnections,
              oldToNewIdMap
            );

            set((state) => {
              if (!state.workflow) return;

              state.workflow.actions.push(...newActions);

              // Merge connections
              for (const [sourceId, connections] of Object.entries(
                newConnections
              )) {
                if (!state.workflow.connections[sourceId]) {
                  state.workflow.connections[sourceId] = {};
                }

                const sourceConns = state.workflow.connections[sourceId];
                if (!sourceConns) continue;

                for (const [type, outputs] of Object.entries(connections)) {
                  if (
                    outputs &&
                    Array.isArray(outputs) &&
                    isValidConnectionType(type)
                  ) {
                    (sourceConns as Record<string, unknown>)[type] = outputs;
                  }
                }
              }

              // Select pasted nodes
              state.selectedNodes = newActions.map((a) => a.id);
              state.isDirty = true;
            });

            get().recordHistory(`Paste ${newActions.length} actions`);
          },

          cut: () => {
            get().copy();
            const { selectedNodes } = get();
            if (selectedNodes.length > 0) {
              get().deleteActions(selectedNodes);
            }
          },

          duplicate: () => {
            get().copy();
            get().paste();
          },

          // ========================================================================
          // History
          // ========================================================================

          undo: () => {
            const { history, historyIndex } = get();
            if (historyIndex <= 0) return;

            const newIndex = historyIndex - 1;
            const historyState = history[newIndex];
            if (!historyState) return;

            set((s) => {
              s.workflow = historyState.workflow;
              s.historyIndex = newIndex;
              s.isDirty = true;
            });
          },

          redo: () => {
            const { history, historyIndex } = get();
            if (historyIndex >= history.length - 1) return;

            const newIndex = historyIndex + 1;
            const historyState = history[newIndex];
            if (!historyState) return;

            set((s) => {
              s.workflow = historyState.workflow;
              s.historyIndex = newIndex;
              s.isDirty = true;
            });
          },

          canUndo: () => {
            return get().historyIndex > 0;
          },

          canRedo: () => {
            const { history, historyIndex } = get();
            return historyIndex < history.length - 1;
          },

          recordHistory: (description?: string) => {
            const { workflow, maxHistorySize } = get();
            if (!workflow) return;

            // Deep clone workflow
            const workflowSnapshot = JSON.parse(JSON.stringify(workflow));

            const historyState: HistoryState = {
              workflow: workflowSnapshot,
              timestamp: Date.now(),
              description,
            };

            set((state) => {
              // Remove any history after current index (if user made changes after undo)
              const newHistory = state.history.slice(0, state.historyIndex + 1);

              // Add new state
              newHistory.push(historyState);

              // Limit history size
              if (newHistory.length > maxHistorySize) {
                newHistory.shift();
              } else {
                state.historyIndex++;
              }

              state.history = newHistory;
            });
          },

          clearHistory: () => {
            set((state) => {
              state.history = [];
              state.historyIndex = -1;
            });
          },

          // ========================================================================
          // Viewport
          // ========================================================================

          setViewport: (viewport: Partial<Viewport>) => {
            set((state) => {
              state.viewport = { ...state.viewport, ...viewport };
            });
          },

          fitView: () => {
            set((state) => {
              const workflow = state.workflow;
              if (!workflow || workflow.actions.length === 0) {
                state.viewport = { x: 0, y: 0, zoom: 1 };
                return;
              }

              // Calculate bounding box of all actions
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;

              const NODE_WIDTH = 200;
              const NODE_HEIGHT = 100;
              const PADDING = 50;

              for (const action of workflow.actions) {
                const [x, y] = action.position;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + NODE_WIDTH);
                maxY = Math.max(maxY, y + NODE_HEIGHT);
              }

              // Calculate viewport dimensions (assume standard canvas size)
              const viewportWidth =
                typeof window !== "undefined" ? window.innerWidth : 1920;
              const viewportHeight =
                typeof window !== "undefined" ? window.innerHeight : 1080;

              const contentWidth = maxX - minX + 2 * PADDING;
              const contentHeight = maxY - minY + 2 * PADDING;

              // Calculate zoom to fit content
              const zoomX = viewportWidth / contentWidth;
              const zoomY = viewportHeight / contentHeight;
              const zoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 1x

              // Calculate center position
              const centerX = (minX + maxX) / 2;
              const centerY = (minY + maxY) / 2;

              // Calculate viewport offset to center the content
              const x = viewportWidth / 2 - centerX * zoom;
              const y = viewportHeight / 2 - centerY * zoom;

              state.viewport = { x, y, zoom };
            });
          },

          zoomIn: () => {
            set((state) => {
              state.viewport.zoom = Math.min(state.viewport.zoom * 1.2, 2);
            });
          },

          zoomOut: () => {
            set((state) => {
              state.viewport.zoom = Math.max(state.viewport.zoom / 1.2, 0.1);
            });
          },

          resetZoom: () => {
            set((state) => {
              state.viewport.zoom = 1;
            });
          },

          // ========================================================================
          // Editing State
          // ========================================================================

          setDragging: (isDragging: boolean) => {
            set((state) => {
              state.isDragging = isDragging;
            });
          },

          setPanning: (isPanning: boolean) => {
            set((state) => {
              state.isPanning = isPanning;
            });
          },

          // ========================================================================
          // Validation
          // ========================================================================

          validateWorkflow: () => {
            const { workflow } = get();
            if (!workflow) {
              return { valid: true, errors: [], warnings: [] };
            }

            // Import validation functions from canvas-validation
            const {
              validateWorkflow: validate,
            } = require("./canvas-validation");

            // Run comprehensive validation
            const result = validate(workflow, {
              checkCycles: true,
              checkOrphaned: true,
              checkMissingConnections: true,
              checkInvalidConnections: true,
              checkVariables: true,
              checkConfigs: true,
              checkUnreachable: true,
            });

            set((state) => {
              state.validationResult = result;
            });

            return result;
          },

          clearValidation: () => {
            set((state) => {
              state.validationResult = null;
            });
          },

          // ========================================================================
          // UI Settings
          // ========================================================================

          toggleMinimap: () => {
            set((state) => {
              state.showMinimap = !state.showMinimap;
            });
          },

          toggleGrid: () => {
            set((state) => {
              state.showGrid = !state.showGrid;
            });
          },

          toggleSnapToGrid: () => {
            set((state) => {
              state.snapToGrid = !state.snapToGrid;
            });
          },

          setGridSize: (size: number) => {
            set((state) => {
              state.gridSize = size;
            });
          },

          // ========================================================================
          // Utility
          // ========================================================================

          getActionById: (actionId: string) => {
            const { workflow } = get();
            return workflow?.actions.find((a) => a.id === actionId);
          },

          getConnectionsForAction: (actionId: string) => {
            const { workflow } = get();
            if (!workflow) return [];

            const connections: Connection[] = [];
            const actionConnections = workflow.connections[actionId];

            if (actionConnections) {
              for (const outputs of Object.values(actionConnections)) {
                for (const outputConns of outputs || []) {
                  connections.push(...outputConns);
                }
              }
            }

            return connections;
          },

          findActionsByType: (type: string) => {
            const { workflow } = get();
            return workflow?.actions.filter((a) => a.type === type) || [];
          },
        }),
        {
          name: "canvas-storage",
          partialize: (state) => ({
            viewport: state.viewport,
            showMinimap: state.showMinimap,
            showGrid: state.showGrid,
            snapToGrid: state.snapToGrid,
            gridSize: state.gridSize,
          }),
        }
      )
    ),
    { name: "CanvasStore" }
  )
);
