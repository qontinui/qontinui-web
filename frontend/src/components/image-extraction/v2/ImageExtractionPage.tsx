/**
 * Image Extraction Page (V2)
 *
 * Main container component for the Image Extraction feature.
 * Composes sub-components and provides the main workflow.
 *
 * Key improvements over V1:
 * - Uses base64 data URLs (no blob URL expiration issues)
 * - Modular components following SRP
 * - Simplified state management with Zustand persist
 */

import React, { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { useImageExtraction } from "@/hooks/use-image-extraction";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { ExtractionSettingsPanel } from "./ExtractionSettingsPanel";
import { EditorPanel } from "./EditorPanel";
import { ResultsPanel } from "./ResultsPanel";
import { SaveImageDialog } from "./SaveImageDialog";
import { MaskEditor } from "@/components/mask-editor";
import { prepareStateImageCreation } from "@/lib/state-image-creator";
import { createImageAsset, findImageByData } from "@/lib/image-library-utils";
import { projectService } from "@/services/service-factory";
import { projectLogger } from "@/lib/project-logger";

export const ImageExtractionPage: React.FC = () => {
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
    isHydrated,
    hasScreenshot,
    canExtract,
    handleUploadScreenshot,
    handleCaptureMultipleScreenshots,
    handleClearAll,
    setSelectedRegion,
    setViewport,
    setProcessingMode,
    setTolerance,
    handleExtract,
    clearExtractedResult,
    openSaveDialog,
    closeSaveDialog,
    updateSaveDialog,
    openMaskEditor,
    closeMaskEditor,
    updateMaskInResult,
  } = useImageExtraction();

  const { states, addState, updateState, images, addImage, projectId, getConfiguration } = useAutomation();
  const [isExtracting, setIsExtracting] = useState(false);

  // Helper to save configuration to backend immediately
  const saveToBackendImmediately = useCallback(async () => {
    if (!projectId) {
      projectLogger.debug("ImageExtraction", "No projectId - skipping backend save");
      return;
    }

    try {
      // Small delay to ensure local state updates have propagated
      await new Promise(resolve => setTimeout(resolve, 100));

      const config = getConfiguration();
      projectLogger.debug("ImageExtraction", "Saving to backend immediately", {
        projectId,
        stateCount: config.states?.length ?? 0,
        imageCount: config.images?.length ?? 0,
      });

      await projectService.updateProject(projectId, { configuration: config });

      projectLogger.info("ImageExtraction", "Backend save complete", { projectId });
    } catch (error) {
      projectLogger.error("ImageExtraction", "Backend save failed", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Don't throw - this is a best-effort save, local data is still persisted
    }
  }, [projectId, getConfiguration]);

  // Handle extraction with loading state
  const handleExtractClick = useCallback(async () => {
    if (!canExtract) return;

    setIsExtracting(true);
    try {
      await handleExtract();
      toast.success("Image extracted successfully");
    } catch (error) {
      console.error("Extraction failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to extract image"
      );
    } finally {
      setIsExtracting(false);
    }
  }, [canExtract, handleExtract]);

  // Handle opening the mask editor
  const handleEditMask = useCallback(() => {
    if (!extractedResult) return;

    openMaskEditor({
      imageDataUrl: extractedResult.croppedImage,
      initialMaskDataUrl: extractedResult.mask,
    });
  }, [extractedResult, openMaskEditor]);

  // Handle saving the mask from the editor
  const handleSaveMask = useCallback(
    (newMask: string) => {
      updateMaskInResult(newMask);
      closeMaskEditor();
      toast.success("Mask updated");
    },
    [updateMaskInResult, closeMaskEditor]
  );

  // Handle saving the image
  const handleSaveImage = useCallback(async () => {
    if (!extractedResult) return;

    try {
      // First, check if this image already exists in the library
      const existingImage = findImageByData(images, extractedResult.croppedImage);

      let imageAsset;
      let isNewImage = false;

      if (existingImage) {
        imageAsset = existingImage;
      } else {
        // Create new image asset
        imageAsset = createImageAsset(
          extractedResult.croppedImage,
          saveDialog.imageName,
          "image_extraction"
        );

        // Add mask to imageAsset if present
        if (extractedResult.mask) {
          imageAsset = {
            ...imageAsset,
            mask: extractedResult.mask,
          };
        }

        // Add to library
        await addImage(imageAsset);
        isNewImage = true;
      }

      // Debug log: image added to library
      console.log("[ImageExtractionPage] Image added to library:", {
        imageId: imageAsset.id,
        imageName: imageAsset.name,
        hasUrl: !!imageAsset.url,
        urlLength: imageAsset.url?.length,
        hasMask: !!imageAsset.mask,
        isNewImage,
      });

      if (saveDialog.mode === "libraryOnly") {
        toast.success(
          isNewImage
            ? `Saved "${saveDialog.imageName}" to library`
            : "Image already exists in library"
        );
        closeSaveDialog();
        clearExtractedResult();
        return;
      }

      if (saveDialog.mode === "addPattern") {
        // Find the target StateImage
        const targetStateImage = states
          .flatMap((s) => s.stateImages || [])
          .find((si) => si.id === saveDialog.selectedStateImageId);

        if (!targetStateImage) {
          toast.error("Selected StateImage not found");
          return;
        }

        // Find the parent state
        const targetState = states.find((s) =>
          s.stateImages?.some((si) => si.id === saveDialog.selectedStateImageId)
        );

        if (!targetState) {
          toast.error("Parent state not found");
          return;
        }

        // Create the new pattern
        const newPattern = {
          id: `pattern_${Date.now()}`,
          name: saveDialog.imageName,
          imageId: imageAsset.id,
          fixed: saveDialog.fixedLocation,
          searchRegions: saveDialog.fixedLocation && extractedResult.bounds
            ? [{
                id: `search_region_${Date.now()}`,
                name: "Extraction Region",
                x: extractedResult.bounds.x,
                y: extractedResult.bounds.y,
                width: extractedResult.bounds.width,
                height: extractedResult.bounds.height,
              }]
            : [],
        };

        // Update the StateImage with the new pattern
        const updatedStateImages = targetState.stateImages!.map((si) => {
          if (si.id === saveDialog.selectedStateImageId) {
            return {
              ...si,
              patterns: [...(si.patterns || []), newPattern],
            };
          }
          return si;
        }) as typeof targetState.stateImages;

        await updateState({
          ...targetState,
          stateImages: updatedStateImages,
        });

        // Save to backend immediately to prevent data loss on navigation
        await saveToBackendImmediately();

        toast.success(
          isNewImage
            ? `Added pattern to ${targetStateImage.name} (image saved to library)`
            : `Added pattern to ${targetStateImage.name}`
        );
      } else {
        // createStateImage mode
        const searchRegion =
          saveDialog.fixedLocation && extractedResult.bounds
            ? {
                id: `search_region_${Date.now()}`,
                name: "Extraction Region",
                x: extractedResult.bounds.x,
                y: extractedResult.bounds.y,
                width: extractedResult.bounds.width,
                height: extractedResult.bounds.height,
              }
            : undefined;

        const result = prepareStateImageCreation(
          {
            name: saveDialog.imageName,
            imageId: imageAsset.id,
            source: "image-extraction",
            fixed: saveDialog.fixedLocation,
            searchRegion: searchRegion,
          },
          saveDialog.selectedStateId,
          states,
          saveDialog.newStateName.trim() || undefined
        );

        // Debug log: prepareStateImageCreation result
        console.log("[ImageExtractionPage] prepareStateImageCreation result:", {
          action: result.action,
          stateImageId: result.stateImage?.id,
          stateImageName: result.stateImage?.name,
          patternId: result.stateImage?.patterns?.[0]?.id,
          patternImageId: result.stateImage?.patterns?.[0]?.imageId,
          targetStateId: result.targetState?.id,
          targetStateName: result.targetState?.name,
          targetStateImagesCount: result.targetState?.stateImages?.length,
        });

        if (result.action === "create-state" && result.targetState) {
          console.log("[ImageExtractionPage] Creating new state with StateImage");
          await addState(result.targetState);
          // Save to backend immediately to prevent data loss on navigation
          await saveToBackendImmediately();
          toast.success(`Created new state: ${result.targetState.name}`);
        } else if (result.action === "update-state" && result.targetState) {
          console.log("[ImageExtractionPage] Updating existing state with StateImage:", {
            stateId: result.targetState.id,
            stateImagesCount: result.targetState.stateImages?.length,
            lastStateImage: result.targetState.stateImages?.[result.targetState.stateImages.length - 1],
          });
          await updateState(result.targetState);
          // Save to backend immediately to prevent data loss on navigation
          await saveToBackendImmediately();
          toast.success(`Added StateImage to ${result.targetState.name}`);
        }
      }

      // Reset and close
      closeSaveDialog();
      clearExtractedResult();
    } catch (error) {
      console.error("Error saving image:", error);
      toast.error("Failed to save image");
    }
  }, [
    extractedResult,
    saveDialog,
    states,
    images,
    addImage,
    addState,
    updateState,
    closeSaveDialog,
    clearExtractedResult,
    saveToBackendImmediately,
  ]);

  // Show loading state while hydrating
  if (!isHydrated) {
    return (
      <div className="h-full flex flex-col bg-[#0A0A0B]">
        <div className="bg-[#27272A] border-b border-gray-800 px-6 py-4">
          <h1 className="text-2xl font-bold text-white">Image Extraction</h1>
          <p className="text-gray-400 mt-1">
            Extract images from screenshots with optional border and background
            removal
          </p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading saved state...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0A0A0B]">
      {/* Header */}
      <div className="bg-[#27272A] border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold text-white">Image Extraction</h1>
        <p className="text-gray-400 mt-1">
          Extract images from screenshots with optional border and background
          removal
        </p>
      </div>

      <div className="flex-1 flex">
        {/* Left Panel - Screenshot Selection */}
        <ScreenshotPanel
          currentScreenshot={currentScreenshot}
          compositeScreenshots={compositeScreenshots}
          isCompositeMode={isCompositeMode}
          selectedRegion={selectedRegion}
          onUploadScreenshot={handleUploadScreenshot}
          onCaptureMultipleScreenshots={handleCaptureMultipleScreenshots}
          onClearAll={handleClearAll}
        />

        {/* Middle Panel - Settings and Editor */}
        <div className="flex-1 flex h-full">
          <ExtractionSettingsPanel
            processingMode={processingMode}
            tolerance={tolerance}
            canExtract={canExtract && !isExtracting}
            hasScreenshot={hasScreenshot}
            onProcessingModeChange={setProcessingMode}
            onToleranceChange={setTolerance}
            onExtract={handleExtractClick}
          />

          <EditorPanel
            currentScreenshot={currentScreenshot}
            compositeScreenshots={compositeScreenshots}
            isCompositeMode={isCompositeMode}
            selectedRegion={selectedRegion}
            onRegionChange={setSelectedRegion}
            viewport={viewport}
            onViewportChange={setViewport}
          />
        </div>

        {/* Right Panel - Results */}
        <ResultsPanel
          extractedResult={extractedResult}
          processingMode={processingMode}
          tolerance={tolerance}
          selectedRegion={selectedRegion}
          onEditMask={handleEditMask}
          onSave={() => openSaveDialog()}
        />
      </div>

      {/* Save Image Dialog */}
      <SaveImageDialog
        isOpen={saveDialog.isOpen}
        extractedResult={extractedResult}
        saveDialog={saveDialog}
        states={states}
        onUpdateDialog={updateSaveDialog}
        onSave={handleSaveImage}
        onCancel={closeSaveDialog}
      />

      {/* Mask Editor */}
      {maskEditor.isOpen && maskEditor.data && (
        <MaskEditor
          imageUrl={maskEditor.data.imageDataUrl}
          initialMask={maskEditor.data.initialMaskDataUrl}
          onSave={handleSaveMask}
          onCancel={closeMaskEditor}
          open={maskEditor.isOpen}
        />
      )}
    </div>
  );
};
