/**
 * Layout History Store - Track and manage layout changes
 *
 * This store maintains a history of layout changes with undo/redo support,
 * allowing users to experiment with layouts and revert if needed.
 *
 * Features:
 * - Undo/redo layout changes
 * - History navigation
 * - Persistent storage
 * - Metadata tracking
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workflow } from '@/lib/action-schema/action-types';
import { LayoutStyle } from '@/lib/workflow-layout/auto-layout';
import type { LayoutOptions } from '@/services/layout-service';
import type { LayoutStatistics } from '@/services/layout-statistics';

// ============================================================================
// Types
// ============================================================================

export interface LayoutHistoryEntry {
  /** Unique entry ID */
  id: string;

  /** Workflow state at this point */
  workflow: Workflow;

  /** Layout style used */
  style: LayoutStyle;

  /** Layout options used */
  options: LayoutOptions;

  /** Timestamp */
  timestamp: Date;

  /** Optional description */
  description?: string;

  /** Layout statistics */
  statistics?: LayoutStatistics;

  /** Preview thumbnail (base64 data URL) */
  thumbnail?: string;
}

interface LayoutHistoryState {
  /** History entries */
  history: LayoutHistoryEntry[];

  /** Current position in history */
  currentIndex: number;

  /** Maximum history size */
  maxHistorySize: number;

  /** Whether history is enabled */
  enabled: boolean;
}

interface LayoutHistoryActions {
  /** Add a layout to history */
  addLayout: (
    workflow: Workflow,
    style: LayoutStyle,
    options: LayoutOptions,
    description?: string,
    statistics?: LayoutStatistics
  ) => void;

  /** Undo to previous layout */
  undo: () => LayoutHistoryEntry | null;

  /** Redo to next layout */
  redo: () => LayoutHistoryEntry | null;

  /** Check if can undo */
  canUndo: () => boolean;

  /** Check if can redo */
  canRedo: () => boolean;

  /** Go to specific history entry */
  goToEntry: (id: string) => LayoutHistoryEntry | null;

  /** Clear all history */
  clear: () => void;

  /** Get current entry */
  getCurrentEntry: () => LayoutHistoryEntry | null;

  /** Get all entries */
  getEntries: () => LayoutHistoryEntry[];

  /** Set max history size */
  setMaxHistorySize: (size: number) => void;

  /** Enable/disable history */
  setEnabled: (enabled: boolean) => void;

  /** Remove specific entry */
  removeEntry: (id: string) => void;

  /** Get history statistics */
  getStatistics: () => {
    totalEntries: number;
    currentPosition: number;
    canUndo: boolean;
    canRedo: boolean;
  };
}

export type LayoutHistoryStore = LayoutHistoryState & LayoutHistoryActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: LayoutHistoryState = {
  history: [],
  currentIndex: -1,
  maxHistorySize: 20,
  enabled: true,
};

// ============================================================================
// Store
// ============================================================================

export const useLayoutHistory = create<LayoutHistoryStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addLayout: (
        workflow: Workflow,
        style: LayoutStyle,
        options: LayoutOptions,
        description?: string,
        statistics?: LayoutStatistics
      ) => {
        const state = get();

        if (!state.enabled) return;

        // Create new entry
        const entry: LayoutHistoryEntry = {
          id: `layout-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          workflow: cloneWorkflow(workflow),
          style,
          options: { ...options },
          timestamp: new Date(),
          description,
          statistics,
        };

        set((s) => {
          // Remove any entries after current index (branching history)
          const newHistory = s.history.slice(0, s.currentIndex + 1);

          // Add new entry
          newHistory.push(entry);

          // Limit history size
          if (newHistory.length > s.maxHistorySize) {
            newHistory.shift();
          } else {
            s.currentIndex++;
          }

          return {
            history: newHistory,
            currentIndex: newHistory.length - 1,
          };
        });
      },

      undo: () => {
        const state = get();

        if (!state.canUndo()) return null;

        const newIndex = state.currentIndex - 1;
        const entry = state.history[newIndex];

        set({ currentIndex: newIndex });

        return entry;
      },

      redo: () => {
        const state = get();

        if (!state.canRedo()) return null;

        const newIndex = state.currentIndex + 1;
        const entry = state.history[newIndex];

        set({ currentIndex: newIndex });

        return entry;
      },

      canUndo: () => {
        const state = get();
        return state.currentIndex > 0;
      },

      canRedo: () => {
        const state = get();
        return state.currentIndex < state.history.length - 1;
      },

      goToEntry: (id: string) => {
        const state = get();
        const index = state.history.findIndex(e => e.id === id);

        if (index === -1) return null;

        set({ currentIndex: index });
        return state.history[index];
      },

      clear: () => {
        set({
          history: [],
          currentIndex: -1,
        });
      },

      getCurrentEntry: () => {
        const state = get();
        return state.history[state.currentIndex] || null;
      },

      getEntries: () => {
        return get().history;
      },

      setMaxHistorySize: (size: number) => {
        set((state) => {
          const newHistory = [...state.history];

          // Trim if exceeds new size
          if (newHistory.length > size) {
            const toRemove = newHistory.length - size;
            newHistory.splice(0, toRemove);
            return {
              maxHistorySize: size,
              history: newHistory,
              currentIndex: Math.max(0, state.currentIndex - toRemove),
            };
          }

          return { maxHistorySize: size };
        });
      },

      setEnabled: (enabled: boolean) => {
        set({ enabled });
      },

      removeEntry: (id: string) => {
        set((state) => {
          const index = state.history.findIndex(e => e.id === id);
          if (index === -1) return state;

          const newHistory = state.history.filter(e => e.id !== id);
          let newIndex = state.currentIndex;

          // Adjust current index if needed
          if (index < state.currentIndex) {
            newIndex--;
          } else if (index === state.currentIndex) {
            newIndex = Math.max(0, Math.min(newIndex, newHistory.length - 1));
          }

          return {
            history: newHistory,
            currentIndex: newIndex,
          };
        });
      },

      getStatistics: () => {
        const state = get();
        return {
          totalEntries: state.history.length,
          currentPosition: state.currentIndex + 1,
          canUndo: state.canUndo(),
          canRedo: state.canRedo(),
        };
      },
    }),
    {
      name: 'layout-history-storage',
      partialize: (state) => ({
        // Only persist recent history (last 5 entries)
        history: state.history.slice(-5),
        currentIndex: Math.min(state.currentIndex, 4),
        maxHistorySize: state.maxHistorySize,
        enabled: state.enabled,
      }),
    }
  )
);

// ============================================================================
// Helper Functions
// ============================================================================

function cloneWorkflow(workflow: Workflow): Workflow {
  return JSON.parse(JSON.stringify(workflow));
}

/**
 * Hook to use layout history with workflow synchronization
 */
export function useLayoutHistoryWithWorkflow(workflow: Workflow | null) {
  const history = useLayoutHistory();

  const applyHistoryEntry = (entry: LayoutHistoryEntry) => {
    if (!workflow) return;

    // Apply positions from history entry
    const historyPositions = new Map(
      entry.workflow.actions.map(a => [a.id, a.position])
    );

    for (const action of workflow.actions) {
      const pos = historyPositions.get(action.id);
      if (pos) {
        action.position = [...pos];
      }
    }
  };

  const undoLayout = () => {
    const entry = history.undo();
    if (entry) {
      applyHistoryEntry(entry);
    }
    return entry;
  };

  const redoLayout = () => {
    const entry = history.redo();
    if (entry) {
      applyHistoryEntry(entry);
    }
    return entry;
  };

  return {
    ...history,
    undoLayout,
    redoLayout,
    applyHistoryEntry,
  };
}

/**
 * Format timestamp for display
 */
export function formatHistoryTimestamp(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60000) {
    return 'Just now';
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }

  // Less than 1 day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }

  // More than 1 day
  const days = Math.floor(diff / 86400000);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * Get layout style display name
 */
export function getLayoutStyleName(style: LayoutStyle): string {
  const names: Record<LayoutStyle, string> = {
    [LayoutStyle.HIERARCHICAL]: 'Hierarchical',
    [LayoutStyle.HORIZONTAL]: 'Horizontal',
    [LayoutStyle.TREE]: 'Tree',
    [LayoutStyle.FORCE_DIRECTED]: 'Force-Directed',
    [LayoutStyle.CIRCULAR]: 'Circular',
  };

  return names[style] || style;
}
