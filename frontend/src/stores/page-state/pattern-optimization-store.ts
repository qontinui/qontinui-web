/**
 * Pattern Optimization Page State Store
 *
 * Zustand store for persisting Pattern Optimization page state to IndexedDB.
 * Handles blob storage for screenshots and edited patterns.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { pageStateDB, makePageKey, type PageBlob } from "./page-state-db";

// Enable Immer's MapSet plugin for Set/Map support in drafts
enableMapSet();
import {
  type PatternOptimizationPageState,
  DEFAULT_PATTERN_OPTIMIZATION_STATE,
} from "./types";

// ===== Store State =====

interface PatternOptimizationStoreState extends PatternOptimizationPageState {
  // Hydration status
  isHydrated: boolean;
  isHydrating: boolean;
  hydrationError: Error | null;

  // Object URLs that need cleanup
  _objectUrls: Set<string>;

  // Context for persistence
  _projectName: string | null;
  _userId: string | null;
}

// ===== Store Actions =====

interface PatternOptimizationStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // Screenshot selection
  setSelectedScreenshotId: (id: string | null) => void;

  // Configuration
  setConfig: (config: PatternOptimizationPageState["config"]) => void;
  setSimilarityThreshold: (threshold: number) => void;
  setColorAveraging: (method: "mean" | "median" | "weighted") => void;
  setMorphologicalOps: (
    ops: PatternOptimizationPageState["config"]["morphologicalOps"]
  ) => void;

  // Edit mode
  setEditMode: (mode: "none" | "add" | "remove") => void;
  setEditedPattern: (pattern: Blob | null) => Promise<void>;

  // Step navigation
  setStepIndex: (index: number) => void;

  // Save dialog
  setShowStateImageDialog: (show: boolean) => void;
  setStateImageName: (name: string) => void;
  setSelectedStateId: (id: string) => void;
  setNewStateName: (name: string) => void;
  setFixedLocation: (fixed: boolean) => void;

  // Cleanup
  cleanup: () => void;
}

type PatternOptimizationStore = PatternOptimizationStoreState &
  PatternOptimizationStoreActions;

// ===== Helper Functions =====

/**
 * Convert a data URL or blob URL to a Blob
 * Returns null if the URL is invalid or has been revoked
 */
// Use XHR to fetch blob URLs (bypasses dev-debug-logger fetch interception)
async function urlToBlob(url: string): Promise<Blob | null> {
  if (!url) return null;

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) { // status 0 is valid for blob URLs
        resolve(xhr.response as Blob);
      } else {
        console.warn("[PatternOptimizationStore] Failed to fetch URL:", url, xhr.status);
        resolve(null);
      }
    };

    xhr.onerror = () => {
      console.warn("[PatternOptimizationStore] Could not convert URL to blob:", url);
      resolve(null);
    };

    xhr.send();
  });
}

// ===== Store Implementation =====

export const usePatternOptimizationStore = create<PatternOptimizationStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_PATTERN_OPTIMIZATION_STATE,
      isHydrated: false,
      isHydrating: false,
      hydrationError: null,
      _objectUrls: new Set<string>(),
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
          const pageKey = makePageKey(
            projectName,
            "pattern-optimization",
            userId
          );
          const metadata = await pageStateDB.getPageState(
            projectName,
            "pattern-optimization",
            userId
          );

          if (metadata) {
            // Load blobs and create object URLs
            const blobs = await pageStateDB.getBlobsForPage(pageKey);
            const blobMap = new Map<string, PageBlob>();
            blobs.forEach((blob) => blobMap.set(blob.id, blob));

            const objectUrls = new Set<string>();
            const savedState =
              metadata.state as Partial<PatternOptimizationPageState>;

            // Restore edited pattern
            let editedPatternUrl: string | undefined;
            if (savedState.editedPatternBlobId) {
              const blob = blobMap.get(savedState.editedPatternBlobId);
              if (blob) {
                editedPatternUrl = URL.createObjectURL(blob.data);
                objectUrls.add(editedPatternUrl);
              }
            }

            set((draft) => {
              // Restore all state
              draft.selectedScreenshotId =
                savedState.selectedScreenshotId ?? null;
              draft.config = savedState.config ?? {
                similarityThreshold: 0.8,
                colorAveraging: "mean",
                morphologicalOps: {
                  enabled: false,
                  erosionSize: 1,
                  dilationSize: 1,
                },
              };
              draft.editMode = savedState.editMode ?? "none";
              draft.editedPatternBlobId =
                savedState.editedPatternBlobId ?? null;
              draft.editedPatternUrl = editedPatternUrl;
              draft.stepIndex = savedState.stepIndex ?? 0;
              draft.showStateImageDialog =
                savedState.showStateImageDialog ?? false;
              draft.stateImageName = savedState.stateImageName ?? "";
              draft.selectedStateId = savedState.selectedStateId ?? "";
              draft.newStateName = savedState.newStateName ?? "";
              draft.fixedLocation = savedState.fixedLocation ?? true;
              draft._objectUrls = objectUrls;
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
          console.error("Failed to hydrate pattern optimization state:", error);
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
          "pattern-optimization",
          state._userId
        );

        try {
          // Delete old blobs
          const existingBlobs = await pageStateDB.getBlobsForPage(pageKey);
          for (const blob of existingBlobs) {
            await pageStateDB.deleteBlob(blob.id);
          }

          const blobRefs: string[] = [];

          // Save edited pattern blob
          let editedPatternBlobId: string | null = null;
          if (state.editedPatternUrl) {
            const blob = await urlToBlob(state.editedPatternUrl);
            if (blob) {
              editedPatternBlobId = await pageStateDB.saveBlob(
                pageKey,
                "editedPattern",
                blob
              );
              blobRefs.push(editedPatternBlobId);
            }
          }

          // Save metadata
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName!,
            pageId: "pattern-optimization",
            userId: state._userId!,
            state: {
              selectedScreenshotId: state.selectedScreenshotId,
              config: state.config,
              editMode: state.editMode,
              editedPatternBlobId,
              stepIndex: state.stepIndex,
              showStateImageDialog: state.showStateImageDialog,
              stateImageName: state.stateImageName,
              selectedStateId: state.selectedStateId,
              newStateName: state.newStateName,
              fixedLocation: state.fixedLocation,
            },
            blobRefs,
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist pattern optimization state:", error);
        }
      },

      reset: () => {
        const state = get();
        // Cleanup object URLs
        state._objectUrls.forEach((url) => URL.revokeObjectURL(url));

        set((draft) => {
          Object.assign(draft, DEFAULT_PATTERN_OPTIMIZATION_STATE);
          draft._objectUrls = new Set();
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== Screenshot Selection =====

      setSelectedScreenshotId: (id) => {
        set((draft) => {
          draft.selectedScreenshotId = id;
        });
      },

      // ===== Configuration =====

      setConfig: (config) => {
        set((draft) => {
          draft.config = config;
        });
      },

      setSimilarityThreshold: (threshold) => {
        set((draft) => {
          draft.config.similarityThreshold = threshold;
        });
      },

      setColorAveraging: (method) => {
        set((draft) => {
          draft.config.colorAveraging = method;
        });
      },

      setMorphologicalOps: (ops) => {
        set((draft) => {
          draft.config.morphologicalOps = ops;
        });
      },

      // ===== Edit Mode =====

      setEditMode: (mode) => {
        set((draft) => {
          draft.editMode = mode;
        });
      },

      setEditedPattern: async (pattern) => {
        const state = get();

        // Collect old URL to revoke (can't mutate frozen state outside of set())
        const oldUrl = state.editedPatternUrl;

        if (pattern) {
          const url = URL.createObjectURL(pattern);
          set((draft) => {
            // Remove old URL from tracking
            if (oldUrl) draft._objectUrls.delete(oldUrl);
            draft._objectUrls.add(url);
            draft.editedPatternUrl = url;
            draft.editedPatternBlobId = ""; // Will be set on persist
          });
        } else {
          set((draft) => {
            if (oldUrl) draft._objectUrls.delete(oldUrl);
            draft.editedPatternUrl = undefined;
            draft.editedPatternBlobId = null;
          });
        }

        // Revoke old URL after state update (side effect)
        if (oldUrl) URL.revokeObjectURL(oldUrl);
      },

      // ===== Step Navigation =====

      setStepIndex: (index) => {
        set((draft) => {
          draft.stepIndex = index;
        });
      },

      // ===== Save Dialog =====

      setShowStateImageDialog: (show) => {
        set((draft) => {
          draft.showStateImageDialog = show;
        });
      },

      setStateImageName: (name) => {
        set((draft) => {
          draft.stateImageName = name;
        });
      },

      setSelectedStateId: (id) => {
        set((draft) => {
          draft.selectedStateId = id;
        });
      },

      setNewStateName: (name) => {
        set((draft) => {
          draft.newStateName = name;
        });
      },

      setFixedLocation: (fixed) => {
        set((draft) => {
          draft.fixedLocation = fixed;
        });
      },

      // ===== Cleanup =====

      cleanup: () => {
        const state = get();
        state._objectUrls.forEach((url) => URL.revokeObjectURL(url));
        set((draft) => {
          draft._objectUrls = new Set();
        });
      },
    })),
    { name: "pattern-optimization-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: PatternOptimizationStore) =>
  state.isHydrated;
export const selectIsHydrating = (state: PatternOptimizationStore) =>
  state.isHydrating;
export const selectHydrationError = (state: PatternOptimizationStore) =>
  state.hydrationError;
export const selectSelectedScreenshotId = (state: PatternOptimizationStore) =>
  state.selectedScreenshotId;
export const selectConfig = (state: PatternOptimizationStore) => state.config;
export const selectEditMode = (state: PatternOptimizationStore) =>
  state.editMode;
export const selectEditedPatternUrl = (state: PatternOptimizationStore) =>
  state.editedPatternUrl;
