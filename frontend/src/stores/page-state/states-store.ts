/**
 * States Page State Store
 *
 * Zustand store for persisting States (State Machine) page state to IndexedDB.
 * This page has NO blob storage - just viewport and selection state.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { pageStateDB, makePageKey } from "./page-state-db";

// Enable Immer's MapSet plugin for Set/Map support in drafts
enableMapSet();
import { type StatesPageState, DEFAULT_STATES_STATE } from "./types";

// ===== Store State =====

interface StatesStoreState extends StatesPageState {
  // Hydration status
  isHydrated: boolean;
  isHydrating: boolean;
  hydrationError: Error | null;

  // Context for persistence
  _projectName: string | null;
  _userId: string | null;
}

// ===== Store Actions =====

interface StatesStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // Viewport actions
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;

  // Selection actions
  setSelectedStateIds: (ids: string[]) => void;
  toggleStateId: (id: string) => void;
  setSelectedTransitionIds: (ids: string[]) => void;
  toggleTransitionId: (id: string) => void;

  // Editing actions
  setEditingStateId: (id: string | null) => void;

  // Grid actions
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
}

type StatesStore = StatesStoreState & StatesStoreActions;

// ===== Store Implementation =====

export const useStatesStore = create<StatesStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_STATES_STATE,
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
            "states",
            userId
          );

          if (metadata) {
            const savedState = metadata.state as Partial<StatesPageState>;

            set((draft) => {
              // Restore all state
              draft.viewport = savedState.viewport ?? { x: 0, y: 0, zoom: 1 };
              draft.selectedStateIds = savedState.selectedStateIds ?? [];
              draft.selectedTransitionIds =
                savedState.selectedTransitionIds ?? [];
              draft.editingStateId = savedState.editingStateId ?? null;
              draft.showGrid = savedState.showGrid ?? true;
              draft.snapToGrid = savedState.snapToGrid ?? true;
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
          console.error("Failed to hydrate states page state:", error);
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
          "states",
          state._userId
        );

        try {
          // Save metadata (no blobs for this page)
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName,
            pageId: "states",
            userId: state._userId,
            state: {
              viewport: state.viewport,
              selectedStateIds: state.selectedStateIds,
              selectedTransitionIds: state.selectedTransitionIds,
              editingStateId: state.editingStateId,
              showGrid: state.showGrid,
              snapToGrid: state.snapToGrid,
            },
            blobRefs: [],
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist states page state:", error);
        }
      },

      reset: () => {
        set((draft) => {
          Object.assign(draft, DEFAULT_STATES_STATE);
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== Viewport Actions =====

      setViewport: (viewport) => {
        set((draft) => {
          draft.viewport = viewport;
        });
      },

      // ===== Selection Actions =====

      setSelectedStateIds: (ids) => {
        set((draft) => {
          draft.selectedStateIds = ids;
        });
      },

      toggleStateId: (id) => {
        set((draft) => {
          const index = draft.selectedStateIds.indexOf(id);
          if (index >= 0) {
            draft.selectedStateIds.splice(index, 1);
          } else {
            draft.selectedStateIds.push(id);
          }
        });
      },

      setSelectedTransitionIds: (ids) => {
        set((draft) => {
          draft.selectedTransitionIds = ids;
        });
      },

      toggleTransitionId: (id) => {
        set((draft) => {
          const index = draft.selectedTransitionIds.indexOf(id);
          if (index >= 0) {
            draft.selectedTransitionIds.splice(index, 1);
          } else {
            draft.selectedTransitionIds.push(id);
          }
        });
      },

      // ===== Editing Actions =====

      setEditingStateId: (id) => {
        set((draft) => {
          draft.editingStateId = id;
        });
      },

      // ===== Grid Actions =====

      setShowGrid: (show) => {
        set((draft) => {
          draft.showGrid = show;
        });
      },

      setSnapToGrid: (snap) => {
        set((draft) => {
          draft.snapToGrid = snap;
        });
      },
    })),
    { name: "states-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: StatesStore) => state.isHydrated;
export const selectIsHydrating = (state: StatesStore) => state.isHydrating;
export const selectHydrationError = (state: StatesStore) =>
  state.hydrationError;
export const selectViewport = (state: StatesStore) => state.viewport;
export const selectSelectedStateIds = (state: StatesStore) =>
  state.selectedStateIds;
export const selectSelectedTransitionIds = (state: StatesStore) =>
  state.selectedTransitionIds;
export const selectEditingStateId = (state: StatesStore) =>
  state.editingStateId;
export const selectShowGrid = (state: StatesStore) => state.showGrid;
export const selectSnapToGrid = (state: StatesStore) => state.snapToGrid;
