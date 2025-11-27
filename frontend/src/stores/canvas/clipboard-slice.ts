/**
 * Clipboard Slice - Manages copy/paste/cut/duplicate operations
 *
 * Responsibilities:
 * - Copying selected nodes to clipboard
 * - Pasting nodes from clipboard
 * - Cut operation (copy + delete)
 * - Duplicate operation (copy + paste)
 */

import type { StateCreator } from 'zustand';
import type { CanvasStore, ClipboardSlice, Action, Connections } from './types';

/**
 * Generate a unique ID for actions
 */
function generateActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Deep clone an action with a new ID
 */
function cloneAction(action: Action, offset: { x: number; y: number } = { x: 0, y: 0 }): Action {
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
      newConnections[newSourceId][type] = outputs.map((outputConnections) =>
        outputConnections.map((conn) => ({
          ...conn,
          action: oldToNewIdMap.get(conn.action) || conn.action,
        }))
      );
    }
  }

  return newConnections;
}

export const createClipboardSlice: StateCreator<
  CanvasStore,
  [['zustand/immer', never]],
  [],
  ClipboardSlice
> = (set, get) => ({
  // State
  clipboardNodes: [],
  clipboardConnections: {},

  // Actions
  copy: () => {
    const { workflow, selectedNodes } = get();
    if (!workflow || selectedNodes.length === 0) return;

    const selectedSet = new Set(selectedNodes);
    const nodesToCopy = workflow.actions.filter((a) => selectedSet.has(a.id));

    // Copy connections between selected nodes
    const connectionsToCopy: Connections = {};
    for (const nodeId of selectedNodes) {
      const connections = workflow.connections[nodeId];
      if (!connections) continue;

      connectionsToCopy[nodeId] = {};

      for (const [type, outputs] of Object.entries(connections)) {
        connectionsToCopy[nodeId][type] = outputs?.map((outputConns) =>
          outputConns.filter((conn) => selectedSet.has(conn.action))
        );
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
      offset = {
        x: position.x - firstNode.position[0],
        y: position.y - firstNode.position[1],
      };
    }

    // Clone actions with new IDs
    const oldToNewIdMap = new Map<string, string>();
    const newActions = clipboardNodes.map((action) => {
      const newAction = cloneAction(action, offset);
      oldToNewIdMap.set(action.id, newAction.id);
      return newAction;
    });

    // Update connections
    const newConnections = updateConnectionsForClonedActions(clipboardConnections, oldToNewIdMap);

    set((state) => {
      if (!state.workflow) return;

      state.workflow.actions.push(...newActions);

      // Merge connections
      for (const [sourceId, connections] of Object.entries(newConnections)) {
        if (!state.workflow.connections[sourceId]) {
          state.workflow.connections[sourceId] = {};
        }

        for (const [type, outputs] of Object.entries(connections)) {
          state.workflow.connections[sourceId][type] = outputs;
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
});
