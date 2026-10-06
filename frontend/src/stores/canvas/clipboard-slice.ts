/**
 * Clipboard Slice - Manages copy/paste/cut/duplicate operations
 *
 * Responsibilities:
 * - Copying selected nodes to clipboard
 * - Pasting nodes from clipboard
 * - Cut operation (copy + delete)
 * - Duplicate operation (copy + paste)
 */

import type { StateCreator } from "zustand";
import type {
  CanvasStore,
  ClipboardSlice,
  Connection,
  Connections,
} from "./types";
import {
  cloneAction,
  isValidConnectionType,
  updateConnectionsForClonedActions,
} from "./utils";

export const createClipboardSlice: StateCreator<
  CanvasStore,
  [["zustand/immer", never]],
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
        if (outputs && Array.isArray(outputs) && isValidConnectionType(type)) {
          (connectionsToCopy[nodeId] as Record<string, unknown>)[type] =
            outputs.map((outputConns: Connection[]) =>
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
      for (const [sourceId, connections] of Object.entries(newConnections)) {
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
});
