/**
 * Connection Slice - Manages connections between actions
 *
 * Responsibilities:
 * - Adding/deleting connections
 * - Connection state (dragging, connecting)
 * - Querying connections
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, ConnectionSlice, Connection } from "./types";
import { isValidConnectionType } from "./utils";

export const createConnectionSlice: StateCreator<
  CanvasStore,
  [["zustand/immer", never]],
  [],
  ConnectionSlice
> = (set, get) => ({
  // State
  isConnecting: false,
  connectingFrom: null,

  // Actions
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
      connectingFrom.outputType as "main" | "error" | "success" | "parallel",
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
});
