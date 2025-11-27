/**
 * History Slice - Manages undo/redo functionality
 *
 * Responsibilities:
 * - Recording workflow state changes
 * - Undo/redo operations
 * - History stack management
 * - History size limits
 */

import type { StateCreator } from 'zustand';
import type { CanvasStore, HistorySlice, HistoryState, Workflow } from './types';

export const createHistorySlice: StateCreator<
  CanvasStore,
  [['zustand/immer', never]],
  [],
  HistorySlice
> = (set, get) => ({
  // State
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,

  // Actions
  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const state = history[newIndex];

    set((s) => {
      s.workflow = state.workflow;
      s.historyIndex = newIndex;
      s.isDirty = true;
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const state = history[newIndex];

    set((s) => {
      s.workflow = state.workflow;
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
    const { workflow, history, historyIndex, maxHistorySize } = get();
    if (!workflow) return;

    // Deep clone workflow
    const workflowSnapshot: Workflow = JSON.parse(JSON.stringify(workflow));

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
});
