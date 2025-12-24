/**
 * Dependencies Page State Store
 *
 * Zustand store for persisting Dependencies page state to IndexedDB.
 * Handles state for the workflow dependencies visualization page.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { pageStateDB, makePageKey } from "./page-state-db";
import {
  type DependenciesPageState,
  DEFAULT_DEPENDENCIES_STATE,
} from "./types";

// ===== Store State =====

interface DependenciesStoreState extends DependenciesPageState {
  // Hydration status
  isHydrated: boolean;
  isHydrating: boolean;
  hydrationError: Error | null;

  // Context for persistence
  _projectName: string | null;
  _userId: string | null;
}

// ===== Store Actions =====

interface DependenciesStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // State setters
  setActiveTab: (tab: string) => void;
  setSearchQuery: (query: string) => void;
  setFiltersOpen: (open: boolean) => void;
  setFilters: (filters: Partial<DependenciesPageState["filters"]>) => void;
  setGraphViewport: (
    viewport: Partial<DependenciesPageState["graphViewport"]>
  ) => void;
  setSelectedWorkflowId: (id: string | null) => void;
}

type DependenciesStore = DependenciesStoreState & DependenciesStoreActions;

// ===== Store Implementation =====

export const useDependenciesStore = create<DependenciesStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_DEPENDENCIES_STATE,
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
            "dependencies",
            userId
          );

          if (metadata) {
            const savedState = metadata.state as Partial<DependenciesPageState>;

            set((draft) => {
              // Restore all state
              draft.activeTab = savedState.activeTab ?? "workflows";
              draft.searchQuery = savedState.searchQuery ?? "";
              draft.filtersOpen = savedState.filtersOpen ?? false;
              draft.filters = savedState.filters ?? {
                folders: [],
                tags: [],
                categories: [],
                viewMode: "graph",
              };
              draft.graphViewport = savedState.graphViewport ?? {
                x: 0,
                y: 0,
                zoom: 1,
              };
              draft.selectedWorkflowId = savedState.selectedWorkflowId ?? null;
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
          console.error("Failed to hydrate dependencies state:", error);
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
          "dependencies",
          state._userId
        );

        try {
          // Save metadata (no blobs for this page)
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName!,
            pageId: "dependencies",
            userId: state._userId!,
            state: {
              activeTab: state.activeTab,
              searchQuery: state.searchQuery,
              filtersOpen: state.filtersOpen,
              filters: state.filters,
              graphViewport: state.graphViewport,
              selectedWorkflowId: state.selectedWorkflowId,
            },
            blobRefs: [],
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist dependencies state:", error);
        }
      },

      reset: () => {
        set((draft) => {
          Object.assign(draft, DEFAULT_DEPENDENCIES_STATE);
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== State Setters =====

      setActiveTab: (tab) => {
        set((draft) => {
          draft.activeTab = tab;
        });
      },

      setSearchQuery: (query) => {
        set((draft) => {
          draft.searchQuery = query;
        });
      },

      setFiltersOpen: (open) => {
        set((draft) => {
          draft.filtersOpen = open;
        });
      },

      setFilters: (filters) => {
        set((draft) => {
          draft.filters = { ...draft.filters, ...filters };
        });
      },

      setGraphViewport: (viewport) => {
        set((draft) => {
          draft.graphViewport = { ...draft.graphViewport, ...viewport };
        });
      },

      setSelectedWorkflowId: (id) => {
        set((draft) => {
          draft.selectedWorkflowId = id;
        });
      },
    })),
    { name: "dependencies-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: DependenciesStore) => state.isHydrated;
export const selectIsHydrating = (state: DependenciesStore) =>
  state.isHydrating;
export const selectHydrationError = (state: DependenciesStore) =>
  state.hydrationError;
export const selectActiveTab = (state: DependenciesStore) => state.activeTab;
export const selectSearchQuery = (state: DependenciesStore) =>
  state.searchQuery;
export const selectFiltersOpen = (state: DependenciesStore) =>
  state.filtersOpen;
export const selectFilters = (state: DependenciesStore) => state.filters;
export const selectGraphViewport = (state: DependenciesStore) =>
  state.graphViewport;
export const selectSelectedWorkflowId = (state: DependenciesStore) =>
  state.selectedWorkflowId;
