/**
 * Image Extraction Hook
 *
 * Custom hook for the Image Extraction page.
 * Provides a clean interface for components to interact with screenshots,
 * extraction, and the save workflow.
 *
 * This hook uses the V2 store with base64 data URLs - no blob URL complexity.
 */

import { useCallback, useMemo, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useImageExtractionStoreV2,
  type ScreenshotData,
  type CompositeScreenshotData,
  type ExtractionResultData,
  type SaveMode,
  type MaskEditorData,
  type SaveDialogState,
  type ViewportState,
} from "@/stores/page-state/image-extraction-store-v2";
import {
  fileToDataUrl,
  getImageDimensions,
  createCompositeImage,
  extractFromScreenshot,
  type ProcessingMode,
  type CompositeScreenshotInput,
} from "@/services/image-extraction";
import type { CapturedScreenshot } from "@/components/common/ScreenshotPicker";
import { createLogger } from "@/lib/logger";

const log = createLogger("useImageExtraction");

/**
 * Main hook for Image Extraction functionality
 */
export function useImageExtraction() {
  // Get store state
  const {
    currentScreenshot,
    compositeScreenshots,
    isCompositeMode,
    selectedRegion,
    viewport,
    processingMode,
    tolerance,
    extractedResult,
    saveDialog,
    maskEditor,
    _isHydrated,
  } = useImageExtractionStoreV2(
    useShallow((state) => ({
      currentScreenshot: state.currentScreenshot,
      compositeScreenshots: state.compositeScreenshots,
      isCompositeMode: state.isCompositeMode,
      selectedRegion: state.selectedRegion,
      viewport: state.viewport,
      processingMode: state.processingMode,
      tolerance: state.tolerance,
      extractedResult: state.extractedResult,
      saveDialog: state.saveDialog,
      maskEditor: state.maskEditor,
      _isHydrated: state._isHydrated,
    }))
  );

  // Debug log viewport changes
  useEffect(() => {
    log.debug("viewport changed:", viewport, "isHydrated:", _isHydrated);
  }, [viewport, _isHydrated]);

  // Get store actions
  const {
    setCurrentScreenshot,
    setCompositeScreenshots,
    clearAllScreenshots,
    setIsCompositeMode,
    setSelectedRegion,
    setViewport,
    resetViewport,
    setProcessingMode,
    setTolerance,
    setExtractedResult,
    clearExtractedResult,
    openSaveDialog,
    closeSaveDialog,
    updateSaveDialog,
    openMaskEditor,
    closeMaskEditor,
    updateMaskInResult,
    reset,
  } = useImageExtractionStoreV2();

  // ===== Screenshot Handlers =====

  /**
   * Handle file upload (single screenshot)
   */
  const handleUploadScreenshot = useCallback(
    async (file: File) => {
      const dataUrl = await fileToDataUrl(file);
      const dimensions = await getImageDimensions(dataUrl);

      const screenshot: ScreenshotData = {
        id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        dataUrl,
        width: dimensions.width,
        height: dimensions.height,
      };

      setCurrentScreenshot(screenshot);
      setIsCompositeMode(false);
      setCompositeScreenshots([]);
      setSelectedRegion(null);
      clearExtractedResult();
    },
    [
      setCurrentScreenshot,
      setIsCompositeMode,
      setCompositeScreenshots,
      setSelectedRegion,
      clearExtractedResult,
    ]
  );

  /**
   * Handle capture of multiple screenshots (composite mode)
   */
  const handleCaptureMultipleScreenshots = useCallback(
    async (screenshots: CapturedScreenshot[]) => {
      if (screenshots.length === 0) return;

      // Convert captured screenshots to our format with base64 data URLs
      const compositeData: CompositeScreenshotData[] = await Promise.all(
        screenshots.map(async (s) => {
          const dataUrl = await fileToDataUrl(s.file);
          const dimensions = await getImageDimensions(dataUrl);
          return {
            id: s.id,
            name: s.name,
            dataUrl,
            width: dimensions.width,
            height: dimensions.height,
            monitor: s.monitor,
          };
        })
      );

      setCompositeScreenshots(compositeData);
      setIsCompositeMode(true);
      setSelectedRegion(null);
      clearExtractedResult();

      // Set first screenshot as current for preview
      if (compositeData.length > 0 && compositeData[0]) {
        const first = compositeData[0];
        setCurrentScreenshot({
          id: first.id,
          name: first.name,
          dataUrl: first.dataUrl,
          width: first.width,
          height: first.height,
        });
      }
    },
    [
      setCompositeScreenshots,
      setIsCompositeMode,
      setSelectedRegion,
      clearExtractedResult,
      setCurrentScreenshot,
    ]
  );

  /**
   * Clear all screenshots and reset state
   */
  const handleClearAll = useCallback(() => {
    clearAllScreenshots();
  }, [clearAllScreenshots]);

  // ===== Extraction =====

  /**
   * Helper function to check if two rectangles overlap
   */
  const rectanglesOverlap = (
    r1: { x: number; y: number; width: number; height: number },
    r2: { x: number; y: number; width: number; height: number }
  ): boolean => {
    return !(
      r1.x + r1.width <= r2.x ||
      r2.x + r2.width <= r1.x ||
      r1.y + r1.height <= r2.y ||
      r2.y + r2.height <= r1.y
    );
  };

  /**
   * Extract the selected region with current settings
   */
  const handleExtract = useCallback(async () => {
    if (
      !selectedRegion ||
      selectedRegion.width <= 0 ||
      selectedRegion.height <= 0
    ) {
      throw new Error("No valid region selected");
    }

    let sourceImageDataUrl: string;
    let monitors: number[] | undefined;

    if (isCompositeMode && compositeScreenshots.length > 0) {
      // Create composite image first
      const compositeInput: CompositeScreenshotInput[] =
        compositeScreenshots.map((s) => ({
          id: s.id,
          name: s.name,
          dataUrl: s.dataUrl,
          monitor: s.monitor,
        }));
      const compositeResult = await createCompositeImage(compositeInput);
      sourceImageDataUrl = compositeResult.dataUrl;

      // Determine which monitors the selected region overlaps with
      const overlappingMonitors = compositeScreenshots
        .filter((s) =>
          rectanglesOverlap(selectedRegion, {
            x: s.monitor.x,
            y: s.monitor.y,
            width: s.monitor.width,
            height: s.monitor.height,
          })
        )
        .map((s) => s.monitor.index);

      if (overlappingMonitors.length > 0) {
        monitors = overlappingMonitors.sort((a, b) => a - b);
      }
    } else if (currentScreenshot) {
      sourceImageDataUrl = currentScreenshot.dataUrl;
      // Single screenshot mode - no monitor info available
    } else {
      throw new Error("No screenshot available");
    }

    // Extract the region
    const result = await extractFromScreenshot(
      sourceImageDataUrl,
      selectedRegion,
      {
        processingMode,
        tolerance,
      }
    );

    setExtractedResult({
      croppedImage: result.croppedImage,
      mask: result.mask,
      bounds: result.bounds,
      monitors,
    });

    return result;
  }, [
    selectedRegion,
    isCompositeMode,
    compositeScreenshots,
    currentScreenshot,
    processingMode,
    tolerance,
    setExtractedResult,
  ]);

  // ===== Computed Values =====

  const hasScreenshot = useMemo(
    () =>
      currentScreenshot !== null ||
      (isCompositeMode && compositeScreenshots.length > 0),
    [currentScreenshot, isCompositeMode, compositeScreenshots.length]
  );

  const canExtract = useMemo(
    () =>
      hasScreenshot &&
      selectedRegion !== null &&
      selectedRegion.width > 0 &&
      selectedRegion.height > 0,
    [hasScreenshot, selectedRegion]
  );

  const canSave = useMemo(() => extractedResult !== null, [extractedResult]);

  // ===== Return Values =====

  return {
    // State
    currentScreenshot,
    compositeScreenshots,
    isCompositeMode,
    selectedRegion,
    viewport,
    processingMode,
    tolerance,
    extractedResult,
    saveDialog,
    maskEditor,
    isHydrated: _isHydrated,

    // Computed
    hasScreenshot,
    canExtract,
    canSave,

    // Screenshot actions
    handleUploadScreenshot,
    handleCaptureMultipleScreenshots,
    handleClearAll,

    // Region actions
    setSelectedRegion,

    // Viewport actions
    setViewport,
    resetViewport,

    // Extraction settings
    setProcessingMode,
    setTolerance,

    // Extraction actions
    handleExtract,
    clearExtractedResult,

    // Save dialog actions
    openSaveDialog,
    closeSaveDialog,
    updateSaveDialog,

    // Mask editor actions
    openMaskEditor,
    closeMaskEditor,
    updateMaskInResult,

    // Reset
    reset,
  };
}

// Re-export types for convenience
export type {
  ScreenshotData,
  CompositeScreenshotData,
  ExtractionResultData,
  SaveMode,
  MaskEditorData,
  SaveDialogState,
  ViewportState,
  ProcessingMode,
};
