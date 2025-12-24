/**
 * Image Extraction Store V2
 *
 * Simplified Zustand store for the Image Extraction page.
 * Uses base64 data URLs exclusively - no blob URLs, no caching complexity.
 *
 * Key insight: Base64 data URLs are just strings. They don't expire,
 * don't need special caching, and persist naturally.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Region } from "@/types/pattern-optimization";
import type { MonitorInfo } from "@/components/common/ScreenshotPicker";
import type { ProcessingMode } from "@/services/image-extraction";

// ===== Types =====

/** Screenshot stored as base64 data URL */
export interface ScreenshotData {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** Screenshot with monitor positioning for composite mode */
export interface CompositeScreenshotData extends ScreenshotData {
  monitor: MonitorInfo;
}

/** Extraction result with processed image */
export interface ExtractionResultData {
  croppedImage: string; // base64 data URL
  mask?: string; // base64 data URL (for background mode)
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** Mask editor state */
export interface MaskEditorData {
  imageDataUrl: string;
  initialMaskDataUrl?: string;
}

/** Save dialog state */
export interface SaveDialogState {
  isOpen: boolean;
  mode: "createStateImage" | "addPattern" | "libraryOnly";
  imageName: string;
  selectedStateId: string;
  newStateName: string;
  selectedStateImageId: string;
  fixedLocation: boolean;
}

/** Save modes */
export type SaveMode = "createStateImage" | "addPattern" | "libraryOnly";

// ===== Store State =====

/** Viewport state for zoom/pan */
export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

interface ImageExtractionState {
  // Screenshot data
  currentScreenshot: ScreenshotData | null;
  compositeScreenshots: CompositeScreenshotData[];
  isCompositeMode: boolean;

  // Region selection
  selectedRegion: Region | null;

  // Viewport state (zoom/pan) - NOT persisted
  viewport: ViewportState;

  // Extraction settings
  processingMode: ProcessingMode;
  tolerance: number;

  // Extraction result
  extractedResult: ExtractionResultData | null;

  // Save dialog
  saveDialog: SaveDialogState;

  // Mask editor
  maskEditor: {
    isOpen: boolean;
    data: MaskEditorData | null;
  };

  // Hydration tracking
  _isHydrated: boolean;
}

// ===== Store Actions =====

interface ImageExtractionActions {
  // Screenshot actions
  setCurrentScreenshot: (screenshot: ScreenshotData | null) => void;
  setCompositeScreenshots: (screenshots: CompositeScreenshotData[]) => void;
  addCompositeScreenshot: (screenshot: CompositeScreenshotData) => void;
  removeCompositeScreenshot: (id: string) => void;
  clearAllScreenshots: () => void;
  setIsCompositeMode: (isComposite: boolean) => void;

  // Region actions
  setSelectedRegion: (region: Region | null) => void;

  // Viewport actions
  setViewport: (viewport: Partial<ViewportState>) => void;
  resetViewport: () => void;

  // Extraction settings
  setProcessingMode: (mode: ProcessingMode) => void;
  setTolerance: (tolerance: number) => void;

  // Extraction result
  setExtractedResult: (result: ExtractionResultData | null) => void;
  clearExtractedResult: () => void;

  // Save dialog actions
  openSaveDialog: (mode?: SaveMode) => void;
  closeSaveDialog: () => void;
  updateSaveDialog: (updates: Partial<SaveDialogState>) => void;

  // Mask editor actions
  openMaskEditor: (data: MaskEditorData) => void;
  closeMaskEditor: () => void;
  updateMaskInResult: (newMask: string) => void;

  // Reset
  reset: () => void;
}

type ImageExtractionStore = ImageExtractionState & ImageExtractionActions;

// ===== Default State =====

const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

const DEFAULT_STATE: ImageExtractionState = {
  currentScreenshot: null,
  compositeScreenshots: [],
  isCompositeMode: false,
  selectedRegion: null,
  viewport: { ...DEFAULT_VIEWPORT },
  processingMode: "none",
  tolerance: 10,
  extractedResult: null,
  saveDialog: {
    isOpen: false,
    mode: "createStateImage",
    imageName: "",
    selectedStateId: "",
    newStateName: "",
    selectedStateImageId: "",
    fixedLocation: false,
  },
  maskEditor: {
    isOpen: false,
    data: null,
  },
  _isHydrated: false,
};

// ===== Store Implementation =====

export const useImageExtractionStoreV2 = create<ImageExtractionStore>()(
  devtools(
    persist(
      immer((set) => ({
        ...DEFAULT_STATE,

        // ===== Screenshot Actions =====

        setCurrentScreenshot: (screenshot) => {
          set((state) => {
            state.currentScreenshot = screenshot;
          });
        },

        setCompositeScreenshots: (screenshots) => {
          set((state) => {
            state.compositeScreenshots = screenshots;
            // If we have composite screenshots, also set the first as current
            const first = screenshots[0];
            if (screenshots.length > 0 && !state.currentScreenshot && first) {
              state.currentScreenshot = {
                id: first.id,
                name: first.name,
                dataUrl: first.dataUrl,
                width: first.width,
                height: first.height,
              };
            }
          });
        },

        addCompositeScreenshot: (screenshot) => {
          set((state) => {
            state.compositeScreenshots.push(screenshot);
          });
        },

        removeCompositeScreenshot: (id) => {
          set((state) => {
            state.compositeScreenshots = state.compositeScreenshots.filter(
              (s) => s.id !== id
            );
          });
        },

        clearAllScreenshots: () => {
          set((state) => {
            state.currentScreenshot = null;
            state.compositeScreenshots = [];
            state.isCompositeMode = false;
            state.selectedRegion = null;
            state.extractedResult = null;
          });
        },

        setIsCompositeMode: (isComposite) => {
          set((state) => {
            state.isCompositeMode = isComposite;
          });
        },

        // ===== Region Actions =====

        setSelectedRegion: (region) => {
          set((state) => {
            state.selectedRegion = region;
          });
        },

        // ===== Viewport Actions =====

        setViewport: (viewport) => {
          console.log("[ImageExtractionStore] setViewport called:", viewport);
          set((state) => {
            if (viewport.zoom !== undefined) state.viewport.zoom = viewport.zoom;
            if (viewport.panX !== undefined) state.viewport.panX = viewport.panX;
            if (viewport.panY !== undefined) state.viewport.panY = viewport.panY;
            console.log("[ImageExtractionStore] viewport after update:", { ...state.viewport });
          });
        },

        resetViewport: () => {
          set((state) => {
            state.viewport = { ...DEFAULT_VIEWPORT };
          });
        },

        // ===== Extraction Settings =====

        setProcessingMode: (mode) => {
          set((state) => {
            state.processingMode = mode;
          });
        },

        setTolerance: (tolerance) => {
          set((state) => {
            state.tolerance = tolerance;
          });
        },

        // ===== Extraction Result =====

        setExtractedResult: (result) => {
          set((state) => {
            state.extractedResult = result;
          });
        },

        clearExtractedResult: () => {
          set((state) => {
            state.extractedResult = null;
          });
        },

        // ===== Save Dialog =====

        openSaveDialog: (mode = "createStateImage") => {
          set((state) => {
            state.saveDialog.isOpen = true;
            state.saveDialog.mode = mode;
          });
        },

        closeSaveDialog: () => {
          set((state) => {
            state.saveDialog.isOpen = false;
          });
        },

        updateSaveDialog: (updates) => {
          set((state) => {
            Object.assign(state.saveDialog, updates);
          });
        },

        // ===== Mask Editor =====

        openMaskEditor: (data) => {
          set((state) => {
            state.maskEditor.isOpen = true;
            state.maskEditor.data = data;
          });
        },

        closeMaskEditor: () => {
          set((state) => {
            state.maskEditor.isOpen = false;
            state.maskEditor.data = null;
          });
        },

        updateMaskInResult: (newMask) => {
          set((state) => {
            if (state.extractedResult) {
              state.extractedResult.mask = newMask;
            }
          });
        },

        // ===== Reset =====

        reset: () => {
          set(() => ({ ...DEFAULT_STATE, _isHydrated: true }));
        },
      })),
      {
        name: "image-extraction-v2",
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          // Only persist non-transient state
          // Note: We intentionally persist screenshots as base64 - they're just strings
          currentScreenshot: state.currentScreenshot,
          compositeScreenshots: state.compositeScreenshots,
          isCompositeMode: state.isCompositeMode,
          selectedRegion: state.selectedRegion,
          viewport: state.viewport, // Persist viewport to maintain zoom/pan across sessions
          processingMode: state.processingMode,
          tolerance: state.tolerance,
          extractedResult: state.extractedResult,
          // Don't persist dialog state - it should start closed
        }),
        onRehydrateStorage: () => (state) => {
          console.log("[ImageExtractionStore] onRehydrateStorage called, state:", state ? {
            hasCurrentScreenshot: !!state.currentScreenshot,
            viewport: state.viewport,
            _isHydrated: state._isHydrated,
          } : "null");
          if (state) {
            state._isHydrated = true;
            console.log("[ImageExtractionStore] _isHydrated set to true");
          }
        },
      }
    ),
    { name: "image-extraction-store-v2" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: ImageExtractionStore) =>
  state._isHydrated;

export const selectCurrentScreenshot = (state: ImageExtractionStore) =>
  state.currentScreenshot;

export const selectCompositeScreenshots = (state: ImageExtractionStore) =>
  state.compositeScreenshots;

export const selectIsCompositeMode = (state: ImageExtractionStore) =>
  state.isCompositeMode;

export const selectSelectedRegion = (state: ImageExtractionStore) =>
  state.selectedRegion;

export const selectViewport = (state: ImageExtractionStore) => state.viewport;

export const selectProcessingMode = (state: ImageExtractionStore) =>
  state.processingMode;

export const selectTolerance = (state: ImageExtractionStore) => state.tolerance;

export const selectExtractedResult = (state: ImageExtractionStore) =>
  state.extractedResult;

export const selectSaveDialog = (state: ImageExtractionStore) =>
  state.saveDialog;

export const selectMaskEditor = (state: ImageExtractionStore) =>
  state.maskEditor;

/** Check if we have a valid screenshot to work with */
export const selectHasScreenshot = (state: ImageExtractionStore) =>
  state.currentScreenshot !== null ||
  (state.isCompositeMode && state.compositeScreenshots.length > 0);

/** Check if extraction is ready (has screenshot and region) */
export const selectCanExtract = (state: ImageExtractionStore) =>
  selectHasScreenshot(state) &&
  state.selectedRegion !== null &&
  state.selectedRegion.width > 0 &&
  state.selectedRegion.height > 0;

/** Check if save is ready (has extraction result) */
export const selectCanSave = (state: ImageExtractionStore) =>
  state.extractedResult !== null;
