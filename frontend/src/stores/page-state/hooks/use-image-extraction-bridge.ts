/**
 * Image Extraction Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useImageExtractionStore } from "../image-extraction-store";
import type { Region } from "@/types/pattern-optimization";
import type { ProcessedImageResult } from "@/lib/image-processing";
import type {
  CapturedScreenshot,
  MonitorInfo,
} from "@/components/common/ScreenshotPicker";

// Re-export types for convenience
export type ProcessingMode = "none" | "border" | "background";
export type SaveMode = "createStateImage" | "addPattern" | "libraryOnly";

export interface Screenshot {
  id: string;
  name: string;
  url: string;
  region?: Region;
}

/** Simplified composite screenshot for display (without File) */
export interface DisplayCompositeScreenshot {
  id: string;
  name: string;
  url: string;
  monitor: MonitorInfo;
}

/**
 * Bridge hook for Image Extraction page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function useImageExtractionBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = useImageExtractionStore();
  const hasHydrated = useRef(false);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate on mount
  useEffect(() => {
    if (user?.id && projectName && !hasHydrated.current) {
      hasHydrated.current = true;
      store.hydrate(projectName, user.id);
    }
  }, [user?.id, projectName, store]);

  // Persist on unmount
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      store.persist().finally(() => {
        store.cleanup();
      });
    };
  }, [store]);

  // Debounced persist
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      store.persist();
    }, 500);
  }, [store]);

  // Listen for beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      store.persist();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [store]);

  // Convert store screenshot to component Screenshot format
  const currentScreenshot: Screenshot | null = store.currentScreenshot
    ? {
        id: store.currentScreenshot.id,
        name: store.currentScreenshot.name,
        url: store.currentScreenshot.url || "",
        region: undefined, // Region is stored separately in compositeRegion
      }
    : null;

  // Convert composite screenshots (without File property - for display only)
  // Memoize to prevent unnecessary re-renders of components that depend on this
  const compositeScreenshots: DisplayCompositeScreenshot[] = useMemo(
    () =>
      store.compositeScreenshots.map((cs) => ({
        id: cs.id,
        name: cs.name,
        url: cs.url || "",
        monitor: cs.monitor,
      })),
    [store.compositeScreenshots]
  );

  // Convert extracted result to ProcessedImageResult format
  const extractedResult: ProcessedImageResult | null = store.extractedResult
    ? {
        croppedImage: store.extractedResult.croppedImage || "",
        mask: store.extractedResult.mask,
        bounds: store.extractedResult.bounds,
      }
    : null;

  // Editing mask in component format
  const editingMask = store.editingMask
    ? {
        imageUrl: store.editingMask.imageUrl || "",
        initialMask: store.editingMask.initialMask,
      }
    : null;

  // State setters that mirror the original component's setState functions
  const setCurrentScreenshot = useCallback(
    async (screenshot: Screenshot | null) => {
      if (screenshot) {
        // Create a File-like object from URL if needed
        const response = await fetch(screenshot.url);
        const blob = await response.blob();
        const file = new File([blob], screenshot.name, { type: blob.type });

        await store.setCurrentScreenshot({
          id: screenshot.id,
          name: screenshot.name,
          file,
        });
      } else {
        await store.setCurrentScreenshot(null);
      }
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const handleUploadScreenshot = useCallback(
    async (file: File) => {
      const id = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await store.setCurrentScreenshot({
        id,
        name: file.name,
        file,
      });
      store.setIsCompositeMode(false);
      store.clearCompositeScreenshots();
      store.setCompositeRegion(null);
      store.clearExtractedResult();
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const handleCaptureMultipleScreenshots = useCallback(
    async (screenshots: CapturedScreenshot[]) => {
      const first = screenshots[0];
      if (!first) return;

      console.log("[Bridge] handleCaptureMultipleScreenshots called with:", screenshots.length, "screenshots");

      // Set all composite screenshots at once (atomically)
      store.setCompositeScreenshots(
        screenshots.map((s) => ({
          id: s.id,
          name: s.name,
          file: s.file,
          monitor: s.monitor,
        }))
      );

      store.setIsCompositeMode(true);
      store.setCompositeRegion(null);

      // Set first as current - use the file directly
      await store.setCurrentScreenshot({
        id: first.id,
        name: first.name,
        file: first.file,
      });

      store.clearExtractedResult();
      debouncedPersist();

      console.log("[Bridge] handleCaptureMultipleScreenshots completed");
    },
    [store, debouncedPersist]
  );

  const handleClearScreenshot = useCallback(async () => {
    if (store.isCompositeMode) {
      store.setIsCompositeMode(false);
      store.clearCompositeScreenshots();
      store.setCompositeRegion(null);
    }
    await store.setCurrentScreenshot(null);
    store.clearExtractedResult();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const handleClearAllScreenshots = useCallback(async () => {
    store.clearCompositeScreenshots();
    store.setIsCompositeMode(false);
    store.setCompositeRegion(null);
    await store.setCurrentScreenshot(null);
    store.clearExtractedResult();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const setCompositeRegion = useCallback(
    (region: Region | null) => {
      store.setCompositeRegion(region);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setProcessingMode = useCallback(
    (mode: ProcessingMode) => {
      store.setProcessingMode(mode);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setTolerance = useCallback(
    (tolerance: number) => {
      store.setTolerance(tolerance);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setExtractedResult = useCallback(
    async (result: ProcessedImageResult | null) => {
      if (result) {
        // Convert data URLs to Blobs
        const croppedResponse = await fetch(result.croppedImage);
        const croppedBlob = await croppedResponse.blob();

        let maskBlob: Blob | null = null;
        if (result.mask) {
          const maskResponse = await fetch(result.mask);
          maskBlob = await maskResponse.blob();
        }

        await store.setExtractedResult({
          croppedImage: croppedBlob,
          mask: maskBlob,
          bounds: result.bounds,
        });
      } else {
        await store.setExtractedResult(null);
      }
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setShowSaveDialog = useCallback(
    (show: boolean) => {
      store.setShowSaveDialog(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSaveMode = useCallback(
    (mode: SaveMode) => {
      store.setSaveMode(mode);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setImageName = useCallback(
    (name: string) => {
      store.setImageName(name);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedStateId = useCallback(
    (id: string) => {
      store.setSelectedStateId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setNewStateName = useCallback(
    (name: string) => {
      store.setNewStateName(name);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedStateImageId = useCallback(
    (id: string) => {
      store.setSelectedStateImageId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setFixedLocation = useCallback(
    (fixed: boolean) => {
      store.setFixedLocation(fixed);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setShowMaskEditor = useCallback(
    (show: boolean) => {
      store.setShowMaskEditor(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setEditingMask = useCallback(
    async (mask: { imageUrl: string; initialMask?: string } | null) => {
      if (mask) {
        const imageResponse = await fetch(mask.imageUrl);
        const imageBlob = await imageResponse.blob();

        let initialMaskBlob: Blob | null = null;
        if (mask.initialMask) {
          const maskResponse = await fetch(mask.initialMask);
          initialMaskBlob = await maskResponse.blob();
        }

        await store.setEditingMask({
          imageBlob,
          initialMaskBlob,
        });
      } else {
        await store.setEditingMask(null);
      }
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values (read-only)
    currentScreenshot,
    compositeScreenshots,
    isCompositeMode: store.isCompositeMode,
    compositeRegion: store.compositeRegion,
    processingMode: store.processingMode,
    tolerance: store.tolerance,
    extractedResult,
    showSaveDialog: store.showSaveDialog,
    saveMode: store.saveMode,
    imageName: store.imageName,
    selectedStateId: store.selectedStateId,
    newStateName: store.newStateName,
    selectedStateImageId: store.selectedStateImageId,
    fixedLocation: store.fixedLocation,
    showMaskEditor: store.showMaskEditor,
    editingMask,

    // Actions (same interface as useState setters)
    setCurrentScreenshot,
    handleUploadScreenshot,
    handleCaptureMultipleScreenshots,
    handleClearScreenshot,
    handleClearAllScreenshots,
    setIsCompositeMode: store.setIsCompositeMode,
    setCompositeRegion,
    setProcessingMode,
    setTolerance,
    setExtractedResult,
    setShowSaveDialog,
    setSaveMode,
    setImageName,
    setSelectedStateId,
    setNewStateName,
    setSelectedStateImageId,
    setFixedLocation,
    setShowMaskEditor,
    setEditingMask,
  };
}
