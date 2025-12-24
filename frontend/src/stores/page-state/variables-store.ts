/**
 * Variables Page State Store
 *
 * Zustand store for persisting Variables page state to IndexedDB.
 * Simple state storage with no blob handling.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { pageStateDB, makePageKey } from "./page-state-db";
import { type VariablesPageState, DEFAULT_VARIABLES_STATE } from "./types";

// ===== Store State =====

interface VariablesStoreState extends VariablesPageState {
  // Hydration status
  isHydrated: boolean;
  isHydrating: boolean;
  hydrationError: Error | null;

  // Context for persistence
  _projectName: string | null;
  _userId: string | null;
}

// ===== Store Actions =====

interface VariablesStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // State setters
  setSearchQuery: (query: string) => void;
  setSelectedVariableIds: (ids: string[]) => void;
  setSortField: (field: "name" | "type" | "value" | "createdAt") => void;
  setSortDirection: (direction: "asc" | "desc") => void;
  setFilterType: (type: string | null) => void;
}

type VariablesStore = VariablesStoreState & VariablesStoreActions;

// ===== Store Implementation =====

export const useVariablesStore = create<VariablesStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_VARIABLES_STATE,
      isHydrated: false,
      isHydrating: false,
      hydrationError: null,
      _projectName: null,
      _userId: null,

      // ===== Hydration =====

      hydrate: async (projectName: string, userId: string) => {
        const state = get();

        // Skip if already hydrating or hydrated for same project/user
        if (
          state.isHydrating ||
          (state.isHydrated &&
            state._projectName === projectName &&
            state._userId === userId)
        ) {
          return;
        }

        set((draft) => {
          draft.isHydrating = true;
          draft.hydrationError = null;
          draft._projectName = projectName;
          draft._userId = userId;
        });

        try {
          const metadata = await pageStateDB.getPageState(
            projectName,
            "variables",
            userId
          );

          if (metadata) {
            const savedState = metadata.state as Partial<VariablesPageState>;

            set((draft) => {
              // Restore all state
              draft.searchQuery = savedState.searchQuery ?? "";
              draft.selectedVariableIds = savedState.selectedVariableIds ?? [];
              draft.sortField = savedState.sortField ?? "name";
              draft.sortDirection = savedState.sortDirection ?? "asc";
              draft.filterType = savedState.filterType ?? null;
              draft.isHydrated = true;
              draft.isHydrating = false;
            });
          } else {
            // No saved state, just mark as hydrated
            set((draft) => {
              draft.isHydrated = true;
              draft.isHydrating = false;
            });
          }
        } catch (error) {
          console.error("Failed to hydrate variables state:", error);
          set((draft) => {
            draft.hydrationError = error as Error;
            draft.isHydrating = false;
            draft.isHydrated = true; // Mark as hydrated to allow usage with defaults
          });
        }
      },

      persist: async () => {
        const state = get();
        if (!state._projectName || !state._userId) {
          console.warn("Cannot persist: no project or user context");
          return;
        }

        const pageKey = makePageKey(
          state._projectName,
          "variables",
          state._userId
        );

        try {
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName!,
            pageId: "variables",
            userId: state._userId!,
            state: {
              searchQuery: state.searchQuery,
              selectedVariableIds: state.selectedVariableIds,
              sortField: state.sortField,
              sortDirection: state.sortDirection,
              filterType: state.filterType,
            },
            blobRefs: [], // No blobs for this page
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist variables state:", error);
        }
      },

      reset: () => {
        set((draft) => {
          Object.assign(draft, DEFAULT_VARIABLES_STATE);
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== State Setters =====

      setSearchQuery: (query) => {
        set((draft) => {
          draft.searchQuery = query;
        });
      },

      setSelectedVariableIds: (ids) => {
        set((draft) => {
          draft.selectedVariableIds = ids;
        });
      },

      setSortField: (field) => {
        set((draft) => {
          draft.sortField = field;
        });
      },

      setSortDirection: (direction) => {
        set((draft) => {
          draft.sortDirection = direction;
        });
      },

      setFilterType: (type) => {
        set((draft) => {
          draft.filterType = type;
        });
      },
    })),
    { name: "variables-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: VariablesStore) => state.isHydrated;
export const selectIsHydrating = (state: VariablesStore) => state.isHydrating;
export const selectHydrationError = (state: VariablesStore) =>
  state.hydrationError;
export const selectSearchQuery = (state: VariablesStore) => state.searchQuery;
export const selectSelectedVariableIds = (state: VariablesStore) =>
  state.selectedVariableIds;
export const selectSortField = (state: VariablesStore) => state.sortField;
export const selectSortDirection = (state: VariablesStore) =>
  state.sortDirection;
export const selectFilterType = (state: VariablesStore) => state.filterType;
