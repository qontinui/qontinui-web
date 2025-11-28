/**
 * Favorite Nodes Store
 *
 * Manages user's favorite/bookmarked nodes for quick access.
 * Persists to localStorage with custom ordering support.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ActionType } from "@/lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface FavoriteNodeEntry {
  type: ActionType;
  order: number;
  addedAt: number; // Timestamp
}

export interface FavoriteNodesState {
  favorites: FavoriteNodeEntry[];
}

export interface FavoriteNodesActions {
  /**
   * Add a node type to favorites
   */
  addFavorite: (nodeType: ActionType) => void;

  /**
   * Remove a node type from favorites
   */
  removeFavorite: (nodeType: ActionType) => void;

  /**
   * Toggle favorite status
   */
  toggleFavorite: (nodeType: ActionType) => void;

  /**
   * Check if a node is favorited
   */
  isFavorite: (nodeType: ActionType) => boolean;

  /**
   * Get all favorites in order
   */
  getFavorites: () => FavoriteNodeEntry[];

  /**
   * Reorder favorites
   */
  reorderFavorites: (nodeType: ActionType, newOrder: number) => void;

  /**
   * Clear all favorites
   */
  clearFavorites: () => void;
}

export type FavoriteNodesStore = FavoriteNodesState & FavoriteNodesActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: FavoriteNodesState = {
  favorites: [],
};

// ============================================================================
// Store
// ============================================================================

export const useFavoriteNodes = create<FavoriteNodesStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addFavorite: (nodeType: ActionType) => {
        set((state) => {
          // Don't add if already favorited
          if (state.favorites.some((fav) => fav.type === nodeType)) {
            return state;
          }

          // Add to end with next order number
          const maxOrder = state.favorites.reduce(
            (max, fav) => Math.max(max, fav.order),
            -1
          );

          const newFavorite: FavoriteNodeEntry = {
            type: nodeType,
            order: maxOrder + 1,
            addedAt: Date.now(),
          };

          return {
            favorites: [...state.favorites, newFavorite],
          };
        });
      },

      removeFavorite: (nodeType: ActionType) => {
        set((state) => ({
          favorites: state.favorites.filter((fav) => fav.type !== nodeType),
        }));
      },

      toggleFavorite: (nodeType: ActionType) => {
        const { isFavorite, addFavorite, removeFavorite } = get();
        if (isFavorite(nodeType)) {
          removeFavorite(nodeType);
        } else {
          addFavorite(nodeType);
        }
      },

      isFavorite: (nodeType: ActionType) => {
        return get().favorites.some((fav) => fav.type === nodeType);
      },

      getFavorites: () => {
        const { favorites } = get();
        return [...favorites].sort((a, b) => a.order - b.order);
      },

      reorderFavorites: (nodeType: ActionType, newOrder: number) => {
        set((state) => {
          const favorites = [...state.favorites];
          const index = favorites.findIndex((fav) => fav.type === nodeType);

          if (index === -1) return state;

          const [removed] = favorites.splice(index, 1);
          favorites.splice(newOrder, 0, removed);

          // Update order values
          favorites.forEach((fav, i) => {
            fav.order = i;
          });

          return { favorites };
        });
      },

      clearFavorites: () => {
        set({ favorites: [] });
      },
    }),
    {
      name: "favorite-nodes-storage",
      version: 1,
    }
  )
);

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Get favorite nodes as array of ActionType (for convenience)
 */
export function useFavoriteNodeTypes(): ActionType[] {
  return useFavoriteNodes((state) =>
    state.getFavorites().map((entry) => entry.type)
  );
}

/**
 * Hook to check if a node is favorited
 */
export function useIsFavoriteNode(nodeType: ActionType): boolean {
  return useFavoriteNodes((state) => state.isFavorite(nodeType));
}

/**
 * Hook to toggle favorite with single function
 */
export function useToggleFavorite() {
  return useFavoriteNodes((state) => state.toggleFavorite);
}
