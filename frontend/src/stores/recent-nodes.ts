/**
 * Recent Nodes Store
 *
 * Tracks recently used node types for quick access in the palette.
 * Persists to localStorage and includes frequency tracking.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ActionType } from '@/lib/action-schema/action-types';

// ============================================================================
// Types
// ============================================================================

export interface RecentNodeEntry {
  type: ActionType;
  lastUsed: number; // Timestamp
  useCount: number;
}

export interface RecentNodesState {
  recentNodes: RecentNodeEntry[];
  maxRecent: number;
}

export interface RecentNodesActions {
  /**
   * Add a node type to recent list
   * Updates timestamp and increments count if already exists
   */
  addRecentNode: (nodeType: ActionType) => void;

  /**
   * Get recent nodes sorted by last used
   */
  getRecentNodes: (limit?: number) => RecentNodeEntry[];

  /**
   * Get most frequently used nodes
   */
  getFrequentNodes: (limit?: number) => RecentNodeEntry[];

  /**
   * Clear all recent nodes
   */
  clearRecent: () => void;

  /**
   * Remove a specific node from recents
   */
  removeRecentNode: (nodeType: ActionType) => void;

  /**
   * Check if a node is in recent list
   */
  isRecent: (nodeType: ActionType) => boolean;
}

export type RecentNodesStore = RecentNodesState & RecentNodesActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: RecentNodesState = {
  recentNodes: [],
  maxRecent: 10,
};

// ============================================================================
// Store
// ============================================================================

export const useRecentNodes = create<RecentNodesStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addRecentNode: (nodeType: ActionType) => {
        set((state) => {
          const now = Date.now();
          const existingIndex = state.recentNodes.findIndex(
            (node) => node.type === nodeType
          );

          let newRecent: RecentNodeEntry[];

          if (existingIndex >= 0) {
            // Update existing entry
            newRecent = [...state.recentNodes];
            newRecent[existingIndex] = {
              type: nodeType,
              lastUsed: now,
              useCount: newRecent[existingIndex].useCount + 1,
            };
          } else {
            // Add new entry
            const newEntry: RecentNodeEntry = {
              type: nodeType,
              lastUsed: now,
              useCount: 1,
            };
            newRecent = [newEntry, ...state.recentNodes];
          }

          // Sort by last used (most recent first)
          newRecent.sort((a, b) => b.lastUsed - a.lastUsed);

          // Limit to maxRecent
          if (newRecent.length > state.maxRecent) {
            newRecent = newRecent.slice(0, state.maxRecent);
          }

          return {
            recentNodes: newRecent,
          };
        });
      },

      getRecentNodes: (limit?: number) => {
        const { recentNodes } = get();
        const sorted = [...recentNodes].sort((a, b) => b.lastUsed - a.lastUsed);
        return limit ? sorted.slice(0, limit) : sorted;
      },

      getFrequentNodes: (limit?: number) => {
        const { recentNodes } = get();
        const sorted = [...recentNodes].sort((a, b) => b.useCount - a.useCount);
        return limit ? sorted.slice(0, limit) : sorted;
      },

      clearRecent: () => {
        set({ recentNodes: [] });
      },

      removeRecentNode: (nodeType: ActionType) => {
        set((state) => ({
          recentNodes: state.recentNodes.filter((node) => node.type !== nodeType),
        }));
      },

      isRecent: (nodeType: ActionType) => {
        return get().recentNodes.some((node) => node.type === nodeType);
      },
    }),
    {
      name: 'recent-nodes-storage',
      version: 1,
    }
  )
);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get recent nodes as array of ActionType (for convenience)
 */
export function useRecentNodeTypes(limit?: number): ActionType[] {
  return useRecentNodes((state) =>
    state.getRecentNodes(limit).map((entry) => entry.type)
  );
}

/**
 * Get frequent nodes as array of ActionType (for convenience)
 */
export function useFrequentNodeTypes(limit?: number): ActionType[] {
  return useRecentNodes((state) =>
    state.getFrequentNodes(limit).map((entry) => entry.type)
  );
}

/**
 * Hook to check if a node is recent
 */
export function useIsRecentNode(nodeType: ActionType): boolean {
  return useRecentNodes((state) => state.isRecent(nodeType));
}
