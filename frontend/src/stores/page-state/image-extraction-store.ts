/**
 * Image Extraction Page State Store
 *
 * Zustand store for persisting Image Extraction page state to IndexedDB.
 * Handles blob storage for screenshots and extracted images.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { pageStateDB, makePageKey, type PageBlob } from "./page-state-db";

// Enable Immer's MapSet plugin for Set/Map support in drafts
enableMapSet();
import {
  type ImageExtractionPageState,
  type PersistedScreenshot,
  type PersistedCompositeScreenshot,
  type PersistedExtractedResult,
  type ProcessingMode,
  type SaveMode,
  type MonitorInfo,
  DEFAULT_IMAGE_EXTRACTION_STATE,
} from "./types";
import type { Region } from "@/types/pattern-optimization";

// ===== Store State =====

interface ImageExtractionStoreState extends ImageExtractionPageState {
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

interface ImageExtractionStoreActions {
  // Hydration
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  reset: () => void;

  // Screenshot actions
  setCurrentScreenshot: (
    screenshot: { id: string; name: string; file: File } | null
  ) => Promise<void>;
  addCompositeScreenshot: (screenshot: {
    id: string;
    name: string;
    file: File;
    monitor: MonitorInfo;
  }) => Promise<void>;
  setCompositeScreenshots: (screenshots: Array<{
    id: string;
    name: string;
    file: File;
    monitor: MonitorInfo;
  }>) => void;
  clearCompositeScreenshots: () => void;
  setIsCompositeMode: (mode: boolean) => void;
  setCompositeRegion: (region: Region | null) => void;

  // Processing settings
  setProcessingMode: (mode: ProcessingMode) => void;
  setTolerance: (tolerance: number) => void;

  // Extracted result
  setExtractedResult: (result: {
    croppedImage: Blob;
    mask: Blob | null;
    bounds: { x: number; y: number; width: number; height: number };
  } | null) => Promise<void>;
  clearExtractedResult: () => void;

  // Save dialog
  setShowSaveDialog: (show: boolean) => void;
  setSaveMode: (mode: SaveMode) => void;
  setImageName: (name: string) => void;
  setSelectedStateId: (id: string) => void;
  setNewStateName: (name: string) => void;
  setSelectedStateImageId: (id: string) => void;
  setFixedLocation: (fixed: boolean) => void;

  // Mask editor
  setShowMaskEditor: (show: boolean) => void;
  setEditingMask: (mask: { imageBlob: Blob; initialMaskBlob: Blob | null } | null) => Promise<void>;

  // Cleanup
  cleanup: () => void;
}

type ImageExtractionStore = ImageExtractionStoreState & ImageExtractionStoreActions;

// ===== Helper Functions =====

/**
 * Convert a data URL or blob URL to a Blob
 * Returns null if the URL is invalid or has been revoked
 * Uses XMLHttpRequest to bypass any fetch interception (like dev-debug-logger)
 */
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
        console.warn("[ImageExtractionStore] Failed to fetch URL:", url, xhr.status);
        resolve(null);
      }
    };

    xhr.onerror = () => {
      console.warn("[ImageExtractionStore] Could not convert URL to blob:", url);
      resolve(null);
    };

    xhr.send();
  });
}

// ===== Store Implementation =====

export const useImageExtractionStore = create<ImageExtractionStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      ...DEFAULT_IMAGE_EXTRACTION_STATE,
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
          const pageKey = makePageKey(projectName, "image-extraction", userId);
          const metadata = await pageStateDB.getPageState(
            projectName,
            "image-extraction",
            userId
          );

          if (metadata) {
            // Load blobs and create object URLs
            const blobs = await pageStateDB.getBlobsForPage(pageKey);
            const blobMap = new Map<string, PageBlob>();
            blobs.forEach((blob) => blobMap.set(blob.id, blob));

            const objectUrls = new Set<string>();
            const savedState = metadata.state as Partial<ImageExtractionPageState>;

            // Check if saved state has stale URLs (URLs without valid blobs)
            // This happens when persist failed before saving blobs
            const hasStaleState =
              (savedState.currentScreenshot?.url && !savedState.currentScreenshot?.blobId) ||
              savedState.compositeScreenshots?.some(
                (cs) => cs.url && !cs.blobId
              ) ||
              (savedState.extractedResult?.croppedImage && !savedState.extractedResult?.croppedImageBlobId);

            if (hasStaleState) {
              console.warn("[ImageExtractionStore] Detected stale state with invalid URLs, clearing metadata");
              // Delete the stale metadata
              await pageStateDB.deletePageState(pageKey);
              // Mark as hydrated with defaults
              set((draft) => {
                draft.isHydrated = true;
                draft.isHydrating = false;
              });
              return;
            }

            // Restore current screenshot
            let currentScreenshot: PersistedScreenshot | null = null;
            if (savedState.currentScreenshot?.blobId) {
              const blob = blobMap.get(savedState.currentScreenshot.blobId);
              if (blob) {
                const url = URL.createObjectURL(blob.data);
                objectUrls.add(url);
                currentScreenshot = {
                  ...savedState.currentScreenshot,
                  url,
                };
              }
            }

            // Restore composite screenshots
            const compositeScreenshots: PersistedCompositeScreenshot[] = [];
            for (const cs of savedState.compositeScreenshots || []) {
              if (cs.blobId) {
                const blob = blobMap.get(cs.blobId);
                if (blob) {
                  const url = URL.createObjectURL(blob.data);
                  objectUrls.add(url);
                  compositeScreenshots.push({ ...cs, url });
                }
              }
            }

            // Restore extracted result
            let extractedResult: PersistedExtractedResult | null = null;
            if (savedState.extractedResult?.croppedImageBlobId) {
              const croppedBlob = blobMap.get(
                savedState.extractedResult.croppedImageBlobId
              );
              if (croppedBlob) {
                const croppedUrl = URL.createObjectURL(croppedBlob.data);
                objectUrls.add(croppedUrl);

                let maskUrl: string | undefined;
                if (savedState.extractedResult.maskBlobId) {
                  const maskBlob = blobMap.get(
                    savedState.extractedResult.maskBlobId
                  );
                  if (maskBlob) {
                    maskUrl = URL.createObjectURL(maskBlob.data);
                    objectUrls.add(maskUrl);
                  }
                }

                extractedResult = {
                  ...savedState.extractedResult,
                  croppedImage: croppedUrl,
                  mask: maskUrl,
                };
              }
            }

            // Restore editing mask
            let editingMask = savedState.editingMask;
            if (editingMask?.imageBlobId) {
              const imageBlob = blobMap.get(editingMask.imageBlobId);
              if (imageBlob) {
                const imageUrl = URL.createObjectURL(imageBlob.data);
                objectUrls.add(imageUrl);

                let initialMask: string | undefined;
                if (editingMask.initialMaskBlobId) {
                  const maskBlob = blobMap.get(editingMask.initialMaskBlobId);
                  if (maskBlob) {
                    initialMask = URL.createObjectURL(maskBlob.data);
                    objectUrls.add(initialMask);
                  }
                }

                editingMask = { ...editingMask, imageUrl, initialMask };
              }
            }

            set((draft) => {
              // Restore all state
              draft.currentScreenshot = currentScreenshot;
              draft.compositeScreenshots = compositeScreenshots;
              draft.isCompositeMode = savedState.isCompositeMode ?? false;
              draft.compositeRegion = savedState.compositeRegion ?? null;
              draft.processingMode = savedState.processingMode ?? "none";
              draft.tolerance = savedState.tolerance ?? 10;
              draft.extractedResult = extractedResult;
              draft.showSaveDialog = savedState.showSaveDialog ?? false;
              draft.saveMode = savedState.saveMode ?? "createStateImage";
              draft.imageName = savedState.imageName ?? "";
              draft.selectedStateId = savedState.selectedStateId ?? "";
              draft.newStateName = savedState.newStateName ?? "";
              draft.selectedStateImageId = savedState.selectedStateImageId ?? "";
              draft.fixedLocation = savedState.fixedLocation ?? true;
              draft.showMaskEditor = savedState.showMaskEditor ?? false;
              draft.editingMask = editingMask ?? null;
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
          console.error("Failed to hydrate image extraction state:", error);
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

        // Helper to check if a URL is valid (tracked in _objectUrls)
        // Stale URLs from previous sessions are not tracked and should be skipped
        const isValidUrl = (url: string | undefined): url is string => {
          if (!url) return false;
          // Only persist URLs we created in this session
          return state._objectUrls.has(url);
        };

        const pageKey = makePageKey(
          state._projectName,
          "image-extraction",
          state._userId
        );

        try {
          // Delete old blobs
          const existingBlobs = await pageStateDB.getBlobsForPage(pageKey);
          for (const blob of existingBlobs) {
            await pageStateDB.deleteBlob(blob.id);
          }

          const blobRefs: string[] = [];

          // Save current screenshot blob
          let currentScreenshotState = state.currentScreenshot;
          if (isValidUrl(currentScreenshotState?.url)) {
            const blob = await urlToBlob(currentScreenshotState.url);
            if (blob) {
              const blobId = await pageStateDB.saveBlob(
                pageKey,
                "currentScreenshot",
                blob
              );
              blobRefs.push(blobId);
              currentScreenshotState = {
                ...currentScreenshotState,
                blobId,
                url: undefined,
              };
            } else {
              // URL was invalid, clear the screenshot from persisted state
              currentScreenshotState = null;
            }
          }

          // Save composite screenshots
          const compositeScreenshotsState: PersistedCompositeScreenshot[] = [];
          for (let i = 0; i < state.compositeScreenshots.length; i++) {
            const cs = state.compositeScreenshots[i];
            if (cs && isValidUrl(cs.url)) {
              const blob = await urlToBlob(cs.url);
              if (blob) {
                const blobId = await pageStateDB.saveBlob(
                  pageKey,
                  `compositeScreenshot-${i}`,
                  blob
                );
                blobRefs.push(blobId);
                compositeScreenshotsState.push({
                  id: cs.id,
                  name: cs.name,
                  blobId,
                  monitor: cs.monitor,
                  url: undefined,
                });
              }
              // If blob is null, skip this screenshot (URL was invalid)
            }
          }

          // Save extracted result
          let extractedResultState = state.extractedResult;
          if (isValidUrl(extractedResultState?.croppedImage)) {
            const croppedBlob = await urlToBlob(
              extractedResultState.croppedImage
            );
            if (croppedBlob) {
              const croppedBlobId = await pageStateDB.saveBlob(
                pageKey,
                "extractedCropped",
                croppedBlob
              );
              blobRefs.push(croppedBlobId);

              let maskBlobId: string | null = null;
              if (isValidUrl(extractedResultState.mask)) {
                const maskBlob = await urlToBlob(extractedResultState.mask);
                if (maskBlob) {
                  maskBlobId = await pageStateDB.saveBlob(
                    pageKey,
                    "extractedMask",
                    maskBlob
                  );
                  blobRefs.push(maskBlobId);
                }
              }

              extractedResultState = {
                ...extractedResultState,
                croppedImageBlobId: croppedBlobId,
                maskBlobId,
                croppedImage: undefined,
                mask: undefined,
              };
            } else {
              // Cropped image URL was invalid, clear extracted result
              extractedResultState = null;
            }
          }

          // Save editing mask
          let editingMaskState = state.editingMask;
          if (isValidUrl(editingMaskState?.imageUrl)) {
            const imageBlob = await urlToBlob(editingMaskState.imageUrl);
            if (imageBlob) {
              const imageBlobId = await pageStateDB.saveBlob(
                pageKey,
                "editingMaskImage",
                imageBlob
              );
              blobRefs.push(imageBlobId);

              let initialMaskBlobId: string | null = null;
              if (isValidUrl(editingMaskState.initialMask)) {
                const initialBlob = await urlToBlob(
                  editingMaskState.initialMask
                );
                if (initialBlob) {
                  initialMaskBlobId = await pageStateDB.saveBlob(
                    pageKey,
                    "editingMaskInitial",
                    initialBlob
                  );
                  blobRefs.push(initialMaskBlobId);
                }
              }

              editingMaskState = {
                imageBlobId,
                initialMaskBlobId,
                imageUrl: undefined,
                initialMask: undefined,
              };
            } else {
              // Image URL was invalid, clear editing mask state
              editingMaskState = null;
            }
          }

          // Save metadata
          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state._projectName!,
            pageId: "image-extraction",
            userId: state._userId!,
            state: {
              currentScreenshot: currentScreenshotState,
              compositeScreenshots: compositeScreenshotsState,
              isCompositeMode: state.isCompositeMode,
              compositeRegion: state.compositeRegion,
              processingMode: state.processingMode,
              tolerance: state.tolerance,
              extractedResult: extractedResultState,
              showSaveDialog: state.showSaveDialog,
              saveMode: state.saveMode,
              imageName: state.imageName,
              selectedStateId: state.selectedStateId,
              newStateName: state.newStateName,
              selectedStateImageId: state.selectedStateImageId,
              fixedLocation: state.fixedLocation,
              showMaskEditor: state.showMaskEditor,
              editingMask: editingMaskState,
            },
            blobRefs,
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to persist image extraction state:", error);
        }
      },

      reset: () => {
        const state = get();
        // Cleanup object URLs
        state._objectUrls.forEach((url) => URL.revokeObjectURL(url));

        set((draft) => {
          Object.assign(draft, DEFAULT_IMAGE_EXTRACTION_STATE);
          draft._objectUrls = new Set();
          draft.isHydrated = false;
          draft.isHydrating = false;
          draft.hydrationError = null;
        });
      },

      // ===== Screenshot Actions =====

      setCurrentScreenshot: async (screenshot) => {
        const state = get();

        // Collect old URL to revoke (can't mutate frozen state outside of set())
        const oldUrl = state.currentScreenshot?.url;

        if (screenshot) {
          const url = URL.createObjectURL(screenshot.file);
          set((draft) => {
            // Remove old URL from tracking
            if (oldUrl) draft._objectUrls.delete(oldUrl);
            draft._objectUrls.add(url);
            draft.currentScreenshot = {
              id: screenshot.id,
              name: screenshot.name,
              blobId: "", // Will be set on persist
              url,
            };
          });
        } else {
          set((draft) => {
            if (oldUrl) draft._objectUrls.delete(oldUrl);
            draft.currentScreenshot = null;
          });
        }

        // Revoke old URL after state update (side effect)
        if (oldUrl) URL.revokeObjectURL(oldUrl);
      },

      addCompositeScreenshot: async (screenshot) => {
        console.log("[ImageExtractionStore] addCompositeScreenshot called:", screenshot.id, "file size:", screenshot.file?.size);
        const url = URL.createObjectURL(screenshot.file);
        console.log("[ImageExtractionStore] Created blob URL:", url.substring(0, 50));
        set((draft) => {
          draft._objectUrls.add(url);
          draft.compositeScreenshots.push({
            id: screenshot.id,
            name: screenshot.name,
            blobId: "",
            url,
            monitor: screenshot.monitor,
          });
          console.log("[ImageExtractionStore] After push, compositeScreenshots count:", draft.compositeScreenshots.length);
        });
      },

      setCompositeScreenshots: (screenshots) => {
        console.log("[ImageExtractionStore] setCompositeScreenshots called with", screenshots.length, "screenshots");
        const state = get();

        // First, revoke all old URLs
        const urlsToRevoke: string[] = [];
        state.compositeScreenshots.forEach((cs) => {
          if (cs.url) {
            urlsToRevoke.push(cs.url);
          }
        });
        console.log("[ImageExtractionStore] Will revoke", urlsToRevoke.length, "old URLs");

        // Create URLs for all new screenshots
        const newScreenshots = screenshots.map((s) => {
          if (!s.file) {
            console.error("[ImageExtractionStore] setCompositeScreenshots - missing file for:", s.id);
            throw new Error(`Missing file for screenshot ${s.id}`);
          }
          const url = URL.createObjectURL(s.file);
          console.log("[ImageExtractionStore] Created URL:", url, "for:", s.id, "file size:", s.file.size);
          return {
            id: s.id,
            name: s.name,
            blobId: "",
            url,
            monitor: s.monitor,
          };
        });

        // Update state atomically
        set((draft) => {
          // Remove old URLs from tracking
          urlsToRevoke.forEach((url) => draft._objectUrls.delete(url));
          // Add new URLs to tracking
          newScreenshots.forEach((s) => {
            console.log("[ImageExtractionStore] Adding URL to tracking:", s.url);
            draft._objectUrls.add(s.url);
          });
          // Replace screenshots array
          draft.compositeScreenshots = newScreenshots;
          console.log("[ImageExtractionStore] State updated, compositeScreenshots:", draft.compositeScreenshots.length);
        });

        // Revoke old URLs after state update
        urlsToRevoke.forEach((url) => {
          console.log("[ImageExtractionStore] Revoking old URL:", url);
          URL.revokeObjectURL(url);
        });
        console.log("[ImageExtractionStore] setCompositeScreenshots completed");
      },

      clearCompositeScreenshots: () => {
        const state = get();
        // Collect URLs to revoke (can't mutate frozen state outside of set())
        const urlsToRevoke: string[] = [];
        state.compositeScreenshots.forEach((cs) => {
          if (cs.url) {
            urlsToRevoke.push(cs.url);
          }
        });

        // Update state first
        set((draft) => {
          // Remove URLs from tracking set
          urlsToRevoke.forEach((url) => draft._objectUrls.delete(url));
          draft.compositeScreenshots = [];
        });

        // Then revoke URLs (side effect, after state update)
        urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
      },

      setIsCompositeMode: (mode) => {
        set((draft) => {
          draft.isCompositeMode = mode;
        });
      },

      setCompositeRegion: (region) => {
        set((draft) => {
          draft.compositeRegion = region;
        });
      },

      // ===== Processing Settings =====

      setProcessingMode: (mode) => {
        set((draft) => {
          draft.processingMode = mode;
        });
      },

      setTolerance: (tolerance) => {
        set((draft) => {
          draft.tolerance = tolerance;
        });
      },

      // ===== Extracted Result =====

      setExtractedResult: async (result) => {
        const state = get();

        // Collect old URLs to revoke (can't mutate frozen state outside of set())
        const oldCroppedUrl = state.extractedResult?.croppedImage;
        const oldMaskUrl = state.extractedResult?.mask;

        if (result) {
          const croppedUrl = URL.createObjectURL(result.croppedImage);
          const maskUrl = result.mask
            ? URL.createObjectURL(result.mask)
            : undefined;

          set((draft) => {
            // Remove old URLs from tracking
            if (oldCroppedUrl) draft._objectUrls.delete(oldCroppedUrl);
            if (oldMaskUrl) draft._objectUrls.delete(oldMaskUrl);

            draft._objectUrls.add(croppedUrl);
            if (maskUrl) draft._objectUrls.add(maskUrl);

            draft.extractedResult = {
              croppedImageBlobId: "",
              maskBlobId: null,
              bounds: result.bounds,
              croppedImage: croppedUrl,
              mask: maskUrl,
            };
          });
        } else {
          set((draft) => {
            if (oldCroppedUrl) draft._objectUrls.delete(oldCroppedUrl);
            if (oldMaskUrl) draft._objectUrls.delete(oldMaskUrl);
            draft.extractedResult = null;
          });
        }

        // Revoke old URLs after state update (side effect)
        if (oldCroppedUrl) URL.revokeObjectURL(oldCroppedUrl);
        if (oldMaskUrl) URL.revokeObjectURL(oldMaskUrl);
      },

      clearExtractedResult: () => {
        const state = get();
        // Collect old URLs to revoke (can't mutate frozen state outside of set())
        const oldCroppedUrl = state.extractedResult?.croppedImage;
        const oldMaskUrl = state.extractedResult?.mask;

        set((draft) => {
          if (oldCroppedUrl) draft._objectUrls.delete(oldCroppedUrl);
          if (oldMaskUrl) draft._objectUrls.delete(oldMaskUrl);
          draft.extractedResult = null;
        });

        // Revoke old URLs after state update (side effect)
        if (oldCroppedUrl) URL.revokeObjectURL(oldCroppedUrl);
        if (oldMaskUrl) URL.revokeObjectURL(oldMaskUrl);
      },

      // ===== Save Dialog =====

      setShowSaveDialog: (show) => {
        set((draft) => {
          draft.showSaveDialog = show;
        });
      },

      setSaveMode: (mode) => {
        set((draft) => {
          draft.saveMode = mode;
        });
      },

      setImageName: (name) => {
        set((draft) => {
          draft.imageName = name;
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

      setSelectedStateImageId: (id) => {
        set((draft) => {
          draft.selectedStateImageId = id;
        });
      },

      setFixedLocation: (fixed) => {
        set((draft) => {
          draft.fixedLocation = fixed;
        });
      },

      // ===== Mask Editor =====

      setShowMaskEditor: (show) => {
        set((draft) => {
          draft.showMaskEditor = show;
        });
      },

      setEditingMask: async (mask) => {
        const state = get();

        // Collect old URLs to revoke (can't mutate frozen state outside of set())
        const oldImageUrl = state.editingMask?.imageUrl;
        const oldMaskUrl = state.editingMask?.initialMask;

        if (mask) {
          const imageUrl = URL.createObjectURL(mask.imageBlob);
          const initialMask = mask.initialMaskBlob
            ? URL.createObjectURL(mask.initialMaskBlob)
            : undefined;

          set((draft) => {
            // Remove old URLs from tracking
            if (oldImageUrl) draft._objectUrls.delete(oldImageUrl);
            if (oldMaskUrl) draft._objectUrls.delete(oldMaskUrl);

            draft._objectUrls.add(imageUrl);
            if (initialMask) draft._objectUrls.add(initialMask);

            draft.editingMask = {
              imageBlobId: "",
              initialMaskBlobId: null,
              imageUrl,
              initialMask,
            };
          });
        } else {
          set((draft) => {
            if (oldImageUrl) draft._objectUrls.delete(oldImageUrl);
            if (oldMaskUrl) draft._objectUrls.delete(oldMaskUrl);
            draft.editingMask = null;
          });
        }

        // Revoke old URLs after state update (side effect)
        if (oldImageUrl) URL.revokeObjectURL(oldImageUrl);
        if (oldMaskUrl) URL.revokeObjectURL(oldMaskUrl);
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
    { name: "image-extraction-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: ImageExtractionStore) => state.isHydrated;
export const selectIsHydrating = (state: ImageExtractionStore) => state.isHydrating;
export const selectHydrationError = (state: ImageExtractionStore) =>
  state.hydrationError;
export const selectCurrentScreenshot = (state: ImageExtractionStore) =>
  state.currentScreenshot;
export const selectExtractedResult = (state: ImageExtractionStore) =>
  state.extractedResult;
export const selectProcessingMode = (state: ImageExtractionStore) =>
  state.processingMode;
export const selectTolerance = (state: ImageExtractionStore) => state.tolerance;
