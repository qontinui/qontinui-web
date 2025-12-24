/**
 * Screenshots Page State Store
 *
 * Zustand store for persisting Screenshots page state to IndexedDB.
 * Handles blob storage for uploaded screenshots.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { pageStateDB, makePageKey, type PageBlob } from "./page-state-db";

// Enable Immer's MapSet plugin for Set/Map support in drafts
enableMapSet();

import {
  type ScreenshotsPageState,
  type PersistedScreenshot,
  DEFAULT_SCREENSHOTS_STATE,
} from "./types";

// ===== Store State =====

interface ScreenshotsStoreState extends ScreenshotsPageState {
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

interface ScreenshotsStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // Screenshot management
  addScreenshot: (screenshot: {
    id: string;
    name: string;
    file: File;
  }) => Promise<void>;
  removeScreenshot: (id: string) => void;
  updateScreenshotName: (id: string, name: string) => void;
  clearAllScreenshots: () => void;

  // Selection
  selectScreenshot: (id: string) => void;
  deselectScreenshot: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // View settings
  setViewMode: (mode: "grid" | "list") => void;
  setSortBy: (sortBy: "name" | "uploadedAt") => void;
  setSortDirection: (direction: "asc" | "desc") => void;

  // Cleanup
  cleanup: () => void;
}

type ScreenshotsStore = ScreenshotsStoreState & ScreenshotsStoreActions;

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
    xhr.open("GET", url, true);
    xhr.responseType = "blob";

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        // status 0 is valid for blob URLs
        resolve(xhr.response as Blob);
      } else {
        console.warn(
          "[ScreenshotsStore] Failed to fetch URL:",
          url,
          xhr.status
        );
        resolve(null);
      }
    };

    xhr.onerror = () => {
      console.warn("[ScreenshotsStore] Could not convert URL to blob:", url);
      resolve(null);
    };

    xhr.send();
  });
}

// ===== Store Implementation =====

export const useScreenshotsStore = create<ScreenshotsStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_SCREENSHOTS_STATE,
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
          const pageKey = makePageKey(projectName, "screenshots", userId);
          const metadata = await pageStateDB.getPageState(
            projectName,
            "screenshots",
            userId
          );

          if (metadata) {
            // Load blobs and create object URLs
            const blobs = await pageStateDB.getBlobsForPage(pageKey);
            const blobMap = new Map<string, PageBlob>();
            blobs.forEach((blob) => blobMap.set(blob.id, blob));

            const objectUrls = new Set<string>();
            const savedState = metadata.state as Partial<ScreenshotsPageState>;

            // Restore uploaded screenshots
            const uploadedScreenshots: PersistedScreenshot[] = [];
            for (const screenshot of savedState.uploadedScreenshots || []) {
              if (screenshot.blobId) {
                const blob = blobMap.get(screenshot.blobId);
                if (blob) {
                  const url = URL.createObjectURL(blob.data);
                  objectUrls.add(url);
                  uploadedScreenshots.push({
                    ...screenshot,
                    url,
                  });
                }
              }
            }

            set((draft) => {
              // Restore all state
              draft.uploadedScreenshots = uploadedScreenshots;
              draft.selectedScreenshotIds =
                savedState.selectedScreenshotIds ?? [];
              draft.viewMode = savedState.viewMode ?? "grid";
              draft.sortBy = savedState.sortBy ?? "uploadedAt";
              draft.sortDirection = savedState.sortDirection ?? "desc";
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
          console.error("Failed to hydrate screenshots state:", error);
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
          "screenshots",
          state._userId
        );

        try {
          // Delete old blobs
          const existingBlobs = await pageStateDB.getBlobsForPage(pageKey);
          for (const blob of existingBlobs) {
            await pageStateDB.deleteBlob(blob.id);
          }

          const blobRefs: string[] = [];

          // Save screenshot blobs
          const uploadedScreenshotsState: PersistedScreenshot[] = [];
          for (let i = 0; i < state.uploadedScreenshots.length; i++) {
            const screenshot = state.uploadedScreenshots[i];
            if (screenshot && screenshot.url) {
              const blob = await urlToBlob(screenshot.url);
              if (blob) {
                const blobId = await pageStateDB.saveBlob(
                  pageKey,
                  `screenshot-${i}`,
                  blob
                );
                blobRefs.push(blobId);
                uploadedScreenshotsState.push({
                  id: screenshot.id,
                  name: screenshot.name,
                  blobId,
                  region: screenshot.region,
                  url: undefined,
                });
              }
              // If blob is null, skip this screenshot (URL was invalid)
            }
          }

          // Save metadata
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName!,
            pageId: "screenshots",
            userId: state._userId!,
            state: {
              uploadedScreenshots: uploadedScreenshotsState,
              selectedScreenshotIds: state.selectedScreenshotIds,
              viewMode: state.viewMode,
              sortBy: state.sortBy,
              sortDirection: state.sortDirection,
            },
            blobRefs,
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist screenshots state:", error);
        }
      },

      reset: () => {
        const state = get();
        // Cleanup object URLs
        state._objectUrls.forEach((url) => URL.revokeObjectURL(url));

        set((draft) => {
          Object.assign(draft, DEFAULT_SCREENSHOTS_STATE);
          draft._objectUrls = new Set();
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== Screenshot Management =====

      addScreenshot: async (screenshot) => {
        const url = URL.createObjectURL(screenshot.file);
        set((draft) => {
          draft._objectUrls.add(url);
          draft.uploadedScreenshots.push({
            id: screenshot.id,
            name: screenshot.name,
            blobId: "", // Will be set on persist
            url,
          });
        });
      },

      removeScreenshot: (id) => {
        const state = get();
        const screenshot = state.uploadedScreenshots.find((s) => s.id === id);
        // Collect URL to revoke (can't mutate frozen state outside of set())
        const urlToRevoke = screenshot?.url;

        set((draft) => {
          if (urlToRevoke) draft._objectUrls.delete(urlToRevoke);
          draft.uploadedScreenshots = draft.uploadedScreenshots.filter(
            (s) => s.id !== id
          );
          draft.selectedScreenshotIds = draft.selectedScreenshotIds.filter(
            (sid) => sid !== id
          );
        });

        // Revoke URL after state update (side effect)
        if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
      },

      updateScreenshotName: (id, name) => {
        set((draft) => {
          const screenshot = draft.uploadedScreenshots.find((s) => s.id === id);
          if (screenshot) {
            screenshot.name = name;
          }
        });
      },

      clearAllScreenshots: () => {
        const state = get();
        // Collect URLs to revoke (can't mutate frozen state outside of set())
        const urlsToRevoke: string[] = [];
        state.uploadedScreenshots.forEach((s) => {
          if (s.url) {
            urlsToRevoke.push(s.url);
          }
        });

        set((draft) => {
          // Remove URLs from tracking set
          urlsToRevoke.forEach((url) => draft._objectUrls.delete(url));
          draft.uploadedScreenshots = [];
          draft.selectedScreenshotIds = [];
        });

        // Revoke URLs after state update (side effect)
        urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
      },

      // ===== Selection =====

      selectScreenshot: (id) => {
        set((draft) => {
          if (!draft.selectedScreenshotIds.includes(id)) {
            draft.selectedScreenshotIds.push(id);
          }
        });
      },

      deselectScreenshot: (id) => {
        set((draft) => {
          draft.selectedScreenshotIds = draft.selectedScreenshotIds.filter(
            (sid) => sid !== id
          );
        });
      },

      clearSelection: () => {
        set((draft) => {
          draft.selectedScreenshotIds = [];
        });
      },

      selectAll: () => {
        const state = get();
        set((draft) => {
          draft.selectedScreenshotIds = state.uploadedScreenshots.map(
            (s) => s.id
          );
        });
      },

      // ===== View Settings =====

      setViewMode: (mode) => {
        set((draft) => {
          draft.viewMode = mode;
        });
      },

      setSortBy: (sortBy) => {
        set((draft) => {
          draft.sortBy = sortBy;
        });
      },

      setSortDirection: (direction) => {
        set((draft) => {
          draft.sortDirection = direction;
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
    { name: "screenshots-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: ScreenshotsStore) => state.isHydrated;
export const selectIsHydrating = (state: ScreenshotsStore) => state.isHydrating;
export const selectHydrationError = (state: ScreenshotsStore) =>
  state.hydrationError;
export const selectUploadedScreenshots = (state: ScreenshotsStore) =>
  state.uploadedScreenshots;
export const selectSelectedScreenshotIds = (state: ScreenshotsStore) =>
  state.selectedScreenshotIds;
export const selectViewMode = (state: ScreenshotsStore) => state.viewMode;
export const selectSortBy = (state: ScreenshotsStore) => state.sortBy;
export const selectSortDirection = (state: ScreenshotsStore) =>
  state.sortDirection;
