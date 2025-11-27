/**
 * Selection Slice - Manages node and edge selection state
 *
 * Responsibilities:
 * - Selecting/deselecting nodes
 * - Selecting/deselecting edges
 * - Multi-selection
 * - Select all/invert selection
 */

import type { StateCreator } from 'zustand';
import type { CanvasStore, SelectionSlice } from './types';

export const createSelectionSlice: StateCreator<
  CanvasStore,
  [['zustand/immer', never]],
  [],
  SelectionSlice
> = (set, get) => ({
  // State
  selectedNodes: [],
  selectedEdges: [],

  // Actions
  selectNode: (nodeId: string, multi = false) => {
    set((state) => {
      if (multi) {
        if (state.selectedNodes.includes(nodeId)) {
          state.selectedNodes = state.selectedNodes.filter((id) => id !== nodeId);
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
          state.selectedEdges = state.selectedEdges.filter((id) => id !== edgeId);
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

      const allNodeIds = new Set(state.workflow.actions.map((a) => a.id));
      const currentSelection = new Set(state.selectedNodes);

      state.selectedNodes = Array.from(allNodeIds).filter((id) => !currentSelection.has(id));
    });
  },
});
