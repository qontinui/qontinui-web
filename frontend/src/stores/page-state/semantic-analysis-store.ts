/**
 * Semantic Analysis Page State Store
 *
 * Zustand store for persisting Semantic Analysis page state to IndexedDB.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { pageStateDB, makePageKey } from "./page-state-db";

// Enable Immer's MapSet plugin for Set/Map support in drafts
enableMapSet();
import {
  type SemanticAnalysisPageState,
  DEFAULT_SEMANTIC_ANALYSIS_STATE,
} from "./types";

// ===== Store State =====

interface SemanticAnalysisStoreState extends SemanticAnalysisPageState {
  // Hydration status
  isHydrated: boolean;
  isHydrating: boolean;
  hydrationError: Error | null;

  // Context for persistence
  _projectName: string | null;
  _userId: string | null;
}

// ===== Store Actions =====

interface SemanticAnalysisStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // State actions
  setSelectedScreenshotId: (id: string | null) => void;
  setSelectedElementIds: (ids: string[]) => void;
  toggleElementId: (id: string) => void;
  setAnalysisResults: (results: Record<string, unknown>) => void;
  setShowOverlay: (show: boolean) => void;
  setHighlightMode: (mode: "all" | "selected" | "none") => void;
}

type SemanticAnalysisStore = SemanticAnalysisStoreState &
  SemanticAnalysisStoreActions;

// ===== Store Implementation =====

export const useSemanticAnalysisStore = create<SemanticAnalysisStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_SEMANTIC_ANALYSIS_STATE,
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
            "semantic-analysis",
            userId
          );

          if (metadata) {
            const savedState =
              metadata.state as Partial<SemanticAnalysisPageState>;

            set((draft) => {
              // Restore all state
              draft.selectedScreenshotId =
                savedState.selectedScreenshotId ?? null;
              draft.selectedElementIds = savedState.selectedElementIds ?? [];
              draft.analysisResults = savedState.analysisResults ?? {};
              draft.showOverlay = savedState.showOverlay ?? true;
              draft.highlightMode = savedState.highlightMode ?? "all";
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
          console.error("Failed to hydrate semantic analysis state:", error);
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
          "semantic-analysis",
          state._userId
        );

        try {
          // Save metadata
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName,
            pageId: "semantic-analysis",
            userId: state._userId,
            state: {
              selectedScreenshotId: state.selectedScreenshotId,
              selectedElementIds: state.selectedElementIds,
              analysisResults: state.analysisResults,
              showOverlay: state.showOverlay,
              highlightMode: state.highlightMode,
            },
            blobRefs: [],
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist semantic analysis state:", error);
        }
      },

      reset: () => {
        set((draft) => {
          Object.assign(draft, DEFAULT_SEMANTIC_ANALYSIS_STATE);
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== State Actions =====

      setSelectedScreenshotId: (id) => {
        set((draft) => {
          draft.selectedScreenshotId = id;
        });
      },

      setSelectedElementIds: (ids) => {
        set((draft) => {
          draft.selectedElementIds = ids;
        });
      },

      toggleElementId: (id) => {
        set((draft) => {
          const index = draft.selectedElementIds.indexOf(id);
          if (index >= 0) {
            draft.selectedElementIds.splice(index, 1);
          } else {
            draft.selectedElementIds.push(id);
          }
        });
      },

      setAnalysisResults: (results) => {
        set((draft) => {
          draft.analysisResults = results;
        });
      },

      setShowOverlay: (show) => {
        set((draft) => {
          draft.showOverlay = show;
        });
      },

      setHighlightMode: (mode) => {
        set((draft) => {
          draft.highlightMode = mode;
        });
      },
    })),
    { name: "semantic-analysis-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: SemanticAnalysisStore) =>
  state.isHydrated;
export const selectIsHydrating = (state: SemanticAnalysisStore) =>
  state.isHydrating;
export const selectHydrationError = (state: SemanticAnalysisStore) =>
  state.hydrationError;
export const selectSelectedScreenshotId = (state: SemanticAnalysisStore) =>
  state.selectedScreenshotId;
export const selectSelectedElementIds = (state: SemanticAnalysisStore) =>
  state.selectedElementIds;
export const selectAnalysisResults = (state: SemanticAnalysisStore) =>
  state.analysisResults;
export const selectShowOverlay = (state: SemanticAnalysisStore) =>
  state.showOverlay;
export const selectHighlightMode = (state: SemanticAnalysisStore) =>
  state.highlightMode;
