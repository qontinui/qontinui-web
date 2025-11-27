/**
 * Connection Slice - Manages connections between actions
 *
 * Responsibilities:
 * - Adding/deleting connections
 * - Connection state (dragging, connecting)
 * - Querying connections
 */

import type { StateCreator } from 'zustand';
import type { CanvasStore, ConnectionSlice, Connection } from './types';

export const createConnectionSlice: StateCreator<
  CanvasStore,
  [['zustand/immer', never]],
  [],
  ConnectionSlice
> = (set, get) => ({
  // State
  isConnecting: false,
  connectingFrom: null,

  // Actions
  addConnection: (
    sourceId: string,
    outputType: 'main' | 'error' | 'success' | 'parallel',
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

      if (!state.workflow.connections[sourceId][outputType]) {
        state.workflow.connections[sourceId][outputType] = [];
      }

      // Ensure output index array exists
      while (state.workflow.connections[sourceId][outputType]!.length <= outputIndex) {
        state.workflow.connections[sourceId][outputType]!.push([]);
      }

      // Add connection
      const connection: Connection = {
        action: targetId,
        type: outputType,
        index: targetIndex,
      };

      state.workflow.connections[sourceId][outputType]![outputIndex].push(connection);
      state.isDirty = true;
    });
    get().recordHistory('Add connection');
  },

  deleteConnection: (
    sourceId: string,
    outputType: string,
    outputIndex: number,
    targetId: string
  ) => {
    set((state) => {
      if (!state.workflow?.connections[sourceId]?.[outputType]?.[outputIndex]) return;

      state.workflow.connections[sourceId][outputType]![outputIndex] =
        state.workflow.connections[sourceId][outputType]![outputIndex].filter(
          (conn) => conn.action !== targetId
        );

      state.isDirty = true;
    });
    get().recordHistory('Delete connection');
  },

  deleteConnectionsForAction: (actionId: string) => {
    set((state) => {
      if (!state.workflow) return;

      delete state.workflow.connections[actionId];
      state.isDirty = true;
    });
  },

  startConnecting: (actionId: string, outputType: string, outputIndex: number) => {
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
      connectingFrom.outputType as 'main' | 'error' | 'success' | 'parallel',
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
