/**
 * Hook that encapsulates all action handlers for StateDiscoveryTab.
 * Extracts callback logic out of the orchestrator to keep it focused on composition.
 */

import { useCallback } from "react";
import type {
  StateImage,
  DiscoveredState,
  AnalysisConfig,
} from "@/types/stateDiscovery";
import type { ImageAsset } from "@/contexts/automation-context/types";
import {
  filterValidImageFiles,
  similarityToColorTolerance,
} from "../state-discovery-utils";
import type { Region } from "../state-discovery-types";

type ImageSource =
  | "state_discovery"
  | "pattern_optimization"
  | "image_extraction";

interface UseStateDiscoveryActionsParams {
  // State setters
  setScreenshots: (files: File[]) => void;
  setSelectedStateImage: (si: StateImage | null) => void;
  setSelectedState: (state: DiscoveredState | null) => void;
  setSelectedStateImages: (ids: Set<string>) => void;
  setIsAnalyzing: (v: boolean) => void;
  setAnalysisProgress: (v: number) => void;
  setRightPanelTab: (tab: "stateimage" | "state") => void;

  // Current state values
  screenshots: File[];
  uploadId: string | null | undefined;
  selectedStateImage: StateImage | null;
  selectedStateImages: Set<string>;
  similarityThreshold: number;
  selectedRegion: Region | null;
  filterActive: boolean;
  filteredStates: DiscoveredState[];
  filteredStateImages: StateImage[];
  images: ImageAsset[];
  addImage: (asset: ImageAsset) => void;

  // API functions from useStateDiscovery
  uploadScreenshots: (files: File[]) => Promise<void>;
  startAnalysis: (
    config: AnalysisConfig,
    onProgress: (progress: unknown) => void,
    onComplete: () => void
  ) => Promise<void>;
  deleteStateImage: (
    id: string,
    options: { cascade: boolean }
  ) => Promise<void>;
  bulkDeleteStateImages: (
    ids: string[],
    options: { cascade: boolean; skipCritical: boolean }
  ) => Promise<void>;
  saveStructure: (name: string) => Promise<void>;

  // Image library helpers
  imageExistsInLibrary: (images: ImageAsset[], imageData: string) => boolean;
  createImageAsset: (
    imageData: string,
    name: string,
    source: ImageSource
  ) => ImageAsset;
}

export function useStateDiscoveryActions(
  params: UseStateDiscoveryActionsParams
) {
  const {
    setScreenshots,
    setSelectedStateImage,
    setSelectedState,
    setSelectedStateImages,
    setIsAnalyzing,
    setAnalysisProgress,
    setRightPanelTab,
    screenshots,
    uploadId,
    selectedStateImage,
    selectedStateImages,
    similarityThreshold,
    selectedRegion,
    filterActive,
    filteredStates,
    filteredStateImages,
    images,
    addImage,
    uploadScreenshots,
    startAnalysis,
    deleteStateImage: deleteStateImageApi,
    bulkDeleteStateImages: bulkDeleteStateImagesApi,
    saveStructure: saveStructureApi,
    imageExistsInLibrary,
    createImageAsset,
  } = params;

  const handleScreenshotUpload = useCallback(
    async (files: File[]) => {
      const { validFiles, skippedCount } = filterValidImageFiles(files);

      if (validFiles.length === 0) {
        alert("Please upload valid image files (PNG, JPG, JPEG, GIF, or BMP)");
        return;
      }

      if (skippedCount > 0) {
        alert(`${skippedCount} non-image files were skipped`);
      }

      setScreenshots(validFiles);
      try {
        await uploadScreenshots(validFiles);
      } catch (err) {
        console.error("Failed to upload screenshots:", err);
        alert(
          `Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [uploadScreenshots, setScreenshots]
  );

  const handleStartAnalysis = useCallback(async () => {
    if (screenshots.length < 2) {
      alert("Please upload at least 2 screenshots");
      return;
    }

    if (!uploadId) {
      alert(
        "Screenshots need to be uploaded first. Please wait for upload to complete or try uploading again."
      );

      if (screenshots.length > 0) {
        try {
          await uploadScreenshots(screenshots);
        } catch (err) {
          console.error("Failed to upload screenshots:", err);
          alert(
            `Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`
          );
          return;
        }
      } else {
        return;
      }
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);

    const config: AnalysisConfig = {
      minRegionSize: [20, 20],
      maxRegionSize: [500, 500],
      colorTolerance: similarityToColorTolerance(similarityThreshold),
      stabilityThreshold: 0.98,
      varianceThreshold: 10,
      minScreenshotsPresent: 1,
      processingMode: "full",
      enableRectangleDecomposition: true,
      enableCooccurrenceAnalysis: true,
      similarityThreshold: similarityThreshold,
      region: selectedRegion || undefined,
    };

    try {
      await startAnalysis(
        config,
        (progress: unknown) => {
          const typedProgress = progress as { percentage: number };
          setAnalysisProgress(typedProgress.percentage);
        },
        () => {
          setIsAnalyzing(false);
          setAnalysisProgress(100);
        }
      );
    } catch (err) {
      console.error("Analysis failed:", err);
      alert(
        `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setIsAnalyzing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots, uploadId, uploadScreenshots, startAnalysis]);

  const handleStateImageSelect = useCallback(
    (stateImage: StateImage) => {
      setSelectedStateImage(stateImage);
    },
    [setSelectedStateImage]
  );

  const handleStateImageMultiSelect = useCallback(
    (stateImageId: string, ctrlKey: boolean) => {
      if (ctrlKey) {
        const newSelection = new Set(selectedStateImages);
        if (newSelection.has(stateImageId)) {
          newSelection.delete(stateImageId);
        } else {
          newSelection.add(stateImageId);
        }
        setSelectedStateImages(newSelection);
      } else {
        setSelectedStateImages(new Set([stateImageId]));
      }
    },
    [selectedStateImages, setSelectedStateImages]
  );

  const handleDeleteStateImage = useCallback(async () => {
    if (!selectedStateImage) return;

    const confirmed = window.confirm(
      `Delete StateImage "${selectedStateImage.name}"? This action cannot be undone.`
    );

    if (confirmed) {
      try {
        await deleteStateImageApi(selectedStateImage.id, { cascade: true });
        setSelectedStateImage(null);
      } catch (err) {
        console.error("Failed to delete StateImage:", err);
      }
    }
  }, [selectedStateImage, deleteStateImageApi, setSelectedStateImage]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedStateImages.size === 0) return;

    const confirmed = window.confirm(
      `Delete ${selectedStateImages.size} StateImages? This action cannot be undone.`
    );

    if (confirmed) {
      try {
        await bulkDeleteStateImagesApi(Array.from(selectedStateImages), {
          cascade: true,
          skipCritical: true,
        });
        setSelectedStateImages(new Set());
        setSelectedStateImage(null);
      } catch (err) {
        console.error("Failed to delete StateImages:", err);
      }
    }
  }, [
    selectedStateImages,
    bulkDeleteStateImagesApi,
    setSelectedStateImages,
    setSelectedStateImage,
  ]);

  const handleSaveStructure = useCallback(async () => {
    const { toast } = await import("sonner");

    const name = prompt("Enter a name for this state structure:");
    if (!name) return;

    if (filterActive) {
      const confirmed = window.confirm(
        `Filters are active. This will save only the ${filteredStates.length} filtered states ` +
          `and ${filteredStateImages.length} filtered state images. Continue?`
      );
      if (!confirmed) return;
    }

    try {
      await saveStructureApi(name);

      let addedCount = 0;
      for (const stateImage of filteredStateImages) {
        if (stateImage.image_data) {
          if (!imageExistsInLibrary(images, stateImage.image_data)) {
            const imageAsset = createImageAsset(
              stateImage.image_data,
              stateImage.name || `StateImage_${stateImage.id}`,
              "state_discovery"
            );
            addImage(imageAsset);
            addedCount++;
          }
        }
      }

      toast.success(
        `State structure saved successfully! Added ${addedCount} images to Image Library.`
      );
    } catch (err) {
      console.error("Failed to save structure:", err);
      toast.error("Failed to save state structure");
    }
  }, [
    saveStructureApi,
    filteredStates,
    filteredStateImages,
    filterActive,
    images,
    addImage,
    imageExistsInLibrary,
    createImageAsset,
  ]);

  const handleSelectState = useCallback(
    (state: DiscoveredState) => {
      setSelectedState(state);
      setRightPanelTab("state");
    },
    [setSelectedState, setRightPanelTab]
  );

  return {
    handleScreenshotUpload,
    handleStartAnalysis,
    handleStateImageSelect,
    handleStateImageMultiSelect,
    handleDeleteStateImage,
    handleBulkDelete,
    handleSaveStructure,
    handleSelectState,
  };
}
