import React, { useState, useMemo, useCallback } from "react";
import {
  Scissors,
  ImageIcon,
  Plus,
  AlertCircle,
  Edit,
  Library,
  Layers,
  Trash2,
  Monitor,
  Loader2,
} from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import {
  useImageExtractionBridge,
  useImageExtractionStore,

} from "@/stores/page-state";
import type { Screenshot } from "@/stores/page-state";
import {
  ScreenshotPicker,
  CapturedScreenshot,
} from "../common/ScreenshotPicker";
import { AdvancedRegionSelector } from "../pattern-optimization/AdvancedRegionSelector";
import {
  CompositeScreenshotCanvas,
  CompositeScreenshotDisplay,
} from "./CompositeScreenshotCanvas";
import { MaskEditor } from "../mask-editor";
import { Region } from "@/types/pattern-optimization";
import {
  extractRegion,
  removeBorder,
  removeBackground,
  ProcessedImageResult,
} from "@/lib/image-processing";
import { prepareStateImageCreation } from "@/lib/state-image-creator";
import { createImageAsset, findImageByData } from "@/lib/image-library-utils";
import { toast } from "sonner";
import type {
  StateImage,
  Pattern,
  SearchRegion,
} from "@/contexts/automation-context/types";

// Helper to flatten all StateImages with their parent state info
interface StateImageWithContext {
  stateImage: StateImage;
  stateId: string;
  stateName: string;
}

export const ImageExtractionTab: React.FC = () => {
  // Use the persistent page state hook - persists across navigation
  const {
    isHydrated,
    isHydrating,
    currentScreenshot,
    compositeScreenshots,
    isCompositeMode,
    compositeRegion,
    processingMode,
    tolerance,
    extractedResult,
    showSaveDialog,
    saveMode,
    imageName,
    selectedStateId,
    newStateName,
    selectedStateImageId,
    fixedLocation,
    showMaskEditor,
    editingMask,
    // Actions
    handleUploadScreenshot: bridgeHandleUploadScreenshot,
    handleCaptureMultipleScreenshots: bridgeHandleCaptureMultipleScreenshots,
    handleClearScreenshot: bridgeHandleClearScreenshot,
    handleClearAllScreenshots: bridgeHandleClearAllScreenshots,
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
  } = useImageExtractionBridge();

  // Local state for captured screenshots thumbnails (ephemeral, doesn't need persistence)
  const [capturedScreenshots, setCapturedScreenshots] = useState<Screenshot[]>(
    []
  );

  const {
    states,
    addState,
    updateState,
    screenshots: projectScreenshots,
    images,
    addImage,
  } = useAutomation();

  // Flatten all StateImages with their parent state context for the "Add Pattern" dropdown
  const allStateImages = useMemo((): StateImageWithContext[] => {
    const result: StateImageWithContext[] = [];
    for (const state of states) {
      for (const stateImage of state.stateImages || []) {
        result.push({
          stateImage,
          stateId: state.id,
          stateName: state.name,
        });
      }
    }
    return result;
  }, [states]);

  // Wrap bridgeHandleUploadScreenshot to also track in local capturedScreenshots
  const handleUploadScreenshot = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      const id = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newScreenshot: Screenshot = { id, name: file.name, url };

      // Add to local captured screenshots collection for thumbnails
      setCapturedScreenshots((prev) => {
        if (prev.some((s) => s.id === id)) {
          return prev;
        }
        return [...prev, newScreenshot];
      });

      // Use bridge function to persist to IndexedDB
      bridgeHandleUploadScreenshot(file);
    },
    [bridgeHandleUploadScreenshot]
  );

  // Handler for multi-monitor captures with position data
  const handleCaptureMultipleScreenshots = useCallback(
    (screenshots: CapturedScreenshot[]) => {
      // Clear local single-screenshot captures
      setCapturedScreenshots([]);
      // Use bridge function to persist
      bridgeHandleCaptureMultipleScreenshots(screenshots);
    },
    [bridgeHandleCaptureMultipleScreenshots]
  );

  const handleProjectScreenshotSelect = async (screenshotId: string) => {
    const projectScreenshot = projectScreenshots.find(
      (s) => s.id === screenshotId
    );
    if (projectScreenshot && projectScreenshot.url) {
      // Fetch the image using XHR (bypasses dev-debug-logger) and create a file for the bridge
      try {
        const blob = await new Promise<Blob>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", projectScreenshot.url!, true);
          xhr.responseType = "blob";
          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
              resolve(xhr.response as Blob);
            } else {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.send();
        });
        const file = new File([blob], projectScreenshot.name, {
          type: blob.type,
        });
        bridgeHandleUploadScreenshot(file);
      } catch (error) {
        console.error(
          "[ImageExtractionTab] Failed to load project screenshot:",
          error
        );
        toast.error("Failed to load screenshot");
      }
    } else {
      console.warn(
        "[ImageExtractionTab] Project screenshot missing URL:",
        screenshotId
      );
      toast.error("Selected screenshot has no image URL");
    }
  };

  const handleClearScreenshot = () => {
    if (currentScreenshot) {
      // Remove from local captured screenshots collection
      setCapturedScreenshots((prev) =>
        prev.filter((s) => s.id !== currentScreenshot.id)
      );
    }
    // Use bridge function to clear persisted state
    bridgeHandleClearScreenshot();
  };

  const handleClearAllScreenshots = () => {
    // Revoke all local object URLs to free memory
    capturedScreenshots.forEach((s) => {
      if (s.url.startsWith("blob:")) {
        URL.revokeObjectURL(s.url);
      }
    });
    setCapturedScreenshots([]);
    // Use bridge function to clear persisted state
    bridgeHandleClearAllScreenshots();
  };

  const handleSelectCapturedScreenshot = async (screenshot: Screenshot) => {
    // Fetch using XHR (bypasses dev-debug-logger) and re-upload to set as current via bridge
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", screenshot.url, true);
        xhr.responseType = "blob";
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 0) {
            resolve(xhr.response as Blob);
          } else {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send();
      });
      const file = new File([blob], screenshot.name, { type: blob.type });
      bridgeHandleUploadScreenshot(file);
    } catch (error) {
      console.error("[ImageExtractionTab] Failed to select screenshot:", error);
    }
  };

  const handleRegionChange = (region: Region) => {
    // Region changes are stored in compositeRegion for both modes
    setCompositeRegion(region);
  };

  // Handler for region changes in composite mode
  const handleCompositeRegionChange = (region: Region) => {
    setCompositeRegion(region);
  };

  /**
   * Create a composite image from multiple screenshots positioned according to monitor coordinates.
   * Returns a data URL of the composited image.
   */
  const createCompositeImage = useCallback(
    async (screenshots: CompositeScreenshotDisplay[]): Promise<string> => {
      console.log(
        "[createCompositeImage] Starting with",
        screenshots.length,
        "screenshots"
      );

      if (screenshots.length === 0) {
        throw new Error("No screenshots to composite");
      }

      // Get blob from cache using the store's method to ensure we get fresh state
      const getBlobFromCache = (url: string): Blob | undefined => {
        return useImageExtractionStore.getState().getBlobFromCache(url);
      };

      // Log cache state for debugging
      const cacheSize = useImageExtractionStore.getState()._blobCache.size;
      console.log("[createCompositeImage] Blob cache has", cacheSize, "entries");

      // Validate all screenshots have URLs and log cache status
      for (const s of screenshots) {
        if (!s.url) {
          throw new Error(`Screenshot ${s.id} has no URL`);
        }
        const cachedBlob = getBlobFromCache(s.url);
        console.log(
          "[createCompositeImage] Screenshot:",
          s.id,
          "URL:",
          s.url.substring(0, 50),
          "inCache:",
          !!cachedBlob,
          cachedBlob ? `size: ${cachedBlob.size}` : ""
        );
      }

      // Calculate bounds
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const s of screenshots) {
        const { x, y, width, height } = s.monitor;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }

      const compositeWidth = maxX - minX;
      const compositeHeight = maxY - minY;
      console.log(
        "[createCompositeImage] Composite size:",
        compositeWidth,
        "x",
        compositeHeight
      );

      // Load image from blob cache or XHR fallback
      const loadImage = async (
        url: string,
        id: string
      ): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          // First check the blob cache using the store's method for fresh state
          const cachedBlob = getBlobFromCache(url);
          if (cachedBlob) {
            console.log(
              "[createCompositeImage] Found in blob cache:",
              id,
              "size:",
              cachedBlob.size
            );
            const freshUrl = URL.createObjectURL(cachedBlob);
            const img = new Image();
            img.onload = () => {
              console.log(
                "[createCompositeImage] Loaded from cache:",
                id,
                "dimensions:",
                img.width,
                "x",
                img.height
              );
              URL.revokeObjectURL(freshUrl);
              resolve(img);
            };
            img.onerror = () => {
              URL.revokeObjectURL(freshUrl);
              console.error(
                "[createCompositeImage] Failed to load cached blob:",
                id
              );
              reject(
                new Error(
                  `Failed to load image ${id}: Cached data may be corrupted`
                )
              );
            };
            img.src = freshUrl;
            return;
          }

          // Fallback: Try loading directly from the blob URL
          // This can work if the blob URL is still valid
          console.log(
            "[createCompositeImage] Not in cache, trying direct URL load:",
            id,
            "URL:",
            url.substring(0, 60)
          );

          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            console.log(
              "[createCompositeImage] Loaded from direct URL:",
              id,
              "dimensions:",
              img.width,
              "x",
              img.height
            );
            resolve(img);
          };
          img.onerror = () => {
            console.error(
              "[createCompositeImage] Failed to load from direct URL, trying XHR:",
              id
            );

            // Final fallback: XHR
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "blob";

            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 0) {
                const blob = xhr.response as Blob;
                console.log(
                  "[createCompositeImage] Got blob via XHR:",
                  id,
                  "size:",
                  blob.size
                );

                const freshUrl = URL.createObjectURL(blob);
                const xhrImg = new Image();
                xhrImg.onload = () => {
                  console.log(
                    "[createCompositeImage] Loaded from XHR:",
                    id,
                    "dimensions:",
                    xhrImg.width,
                    "x",
                    xhrImg.height
                  );
                  URL.revokeObjectURL(freshUrl);
                  resolve(xhrImg);
                };
                xhrImg.onerror = () => {
                  URL.revokeObjectURL(freshUrl);
                  console.error(
                    "[createCompositeImage] Failed to load image from XHR blob:",
                    id
                  );
                  reject(
                    new Error(
                      `Failed to load image ${id}: Image data may be corrupted`
                    )
                  );
                };
                xhrImg.src = freshUrl;
              } else {
                console.error(
                  "[createCompositeImage] XHR failed:",
                  id,
                  "status:",
                  xhr.status
                );
                reject(
                  new Error(`Failed to load image ${id}: HTTP ${xhr.status}`)
                );
              }
            };

            xhr.onerror = () => {
              console.error(
                "[createCompositeImage] XHR error for:",
                id,
                "URL:",
                url.substring(0, 60)
              );
              reject(new Error(`Failed to load image ${id}: Network error. The blob URL may have been revoked.`));
            };

            xhr.send();
          };
          img.src = url;
        });
      };

      const loadedImages = await Promise.all(
        screenshots.map(async (s) => ({
          screenshot: s,
          image: await loadImage(s.url, s.id),
        }))
      );

      // Create canvas and draw all images at their positions
      const canvas = document.createElement("canvas");
      canvas.width = compositeWidth;
      canvas.height = compositeHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Could not get canvas context");
      }

      // Fill with black background (for gaps between monitors)
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, compositeWidth, compositeHeight);

      // Draw each screenshot at its normalized position
      for (const { screenshot, image } of loadedImages) {
        const x = screenshot.monitor.x - minX;
        const y = screenshot.monitor.y - minY;
        ctx.drawImage(image, x, y);
      }

      return canvas.toDataURL("image/png");
    },
    []
  );

  const handleExtract = async () => {
    if (!activeRegion) {
      toast.error("Please select a region first");
      return;
    }

    try {
      let result: ProcessedImageResult;
      let imageUrl: string;
      let regionToExtract: Region;

      if (isCompositeMode && compositeScreenshots.length > 0) {
        // Create composite image and extract from it
        imageUrl = await createCompositeImage(compositeScreenshots);
        regionToExtract = compositeRegion!;
      } else if (currentScreenshot) {
        imageUrl = currentScreenshot.url;
        regionToExtract = compositeRegion!;
      } else {
        toast.error("No screenshot available");
        return;
      }

      if (processingMode === "none") {
        result = await extractRegion(imageUrl, regionToExtract);
      } else if (processingMode === "border") {
        result = await removeBorder(imageUrl, regionToExtract, tolerance);
      } else {
        result = await removeBackground(imageUrl, regionToExtract, tolerance);
      }

      setExtractedResult(result);
      toast.success("Image extracted successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Extraction failed:", errorMessage, error);
      toast.error(`Failed to extract image: ${errorMessage}`);
    }
  };

  const handleEditMask = () => {
    if (!extractedResult) return;

    setEditingMask({
      imageUrl: extractedResult.croppedImage,
      initialMask: extractedResult.mask,
    });
    setShowMaskEditor(true);
  };

  const handleSaveMask = (maskedImage: string, mask: string) => {
    if (!extractedResult) return;

    // Update the extracted result with the new masked image and mask
    setExtractedResult({
      ...extractedResult,
      croppedImage: maskedImage,
      mask: mask,
    });

    setShowMaskEditor(false);
    setEditingMask(null);
    toast.success("Mask updated");
  };

  const handleSaveImage = async () => {
    if (!extractedResult || !imageName) {
      toast.error("Please enter a name for the image");
      return;
    }

    // Validate based on save mode
    if (saveMode === "createStateImage") {
      if (!selectedStateId) {
        toast.error("Please select a target state");
        return;
      }
      if (selectedStateId === "new" && !newStateName.trim()) {
        toast.error("Please enter a name for the new state");
        return;
      }
    } else if (saveMode === "addPattern") {
      if (!selectedStateImageId) {
        toast.error("Please select a StateImage to add the pattern to");
        return;
      }
    }

    try {
      const imageData = extractedResult.croppedImage;

      // Step 1: Add image to library first (or find existing)
      // The library is the source of truth for all image data
      let imageAsset = findImageByData(images, imageData);
      const isNewImage = !imageAsset;
      if (!imageAsset) {
        imageAsset = createImageAsset(imageData, imageName, "image_extraction");
        // Add mask to the image asset if present
        if (extractedResult.mask) {
          imageAsset.mask = extractedResult.mask;
        }
        // IMPORTANT: await to ensure image is in library before creating patterns that reference it
        await addImage(imageAsset);
      }

      // Handle based on save mode
      if (saveMode === "libraryOnly") {
        // Just save to library - already done above
        if (isNewImage) {
          toast.success("Image saved to library");
        } else {
          toast.info("Image already exists in library");
        }
      } else if (saveMode === "addPattern") {
        // Add as a new pattern to existing StateImage
        // IMPORTANT: Read the LATEST state directly from Zustand store to avoid stale data
        // The React Context's states might not have been updated yet after a previous pattern addition
        const zustandStates = useAutomationStore.getState().states;

        // Find the state that contains this stateImage
        let targetState = null;
        let targetStateImageName = "";
        for (const s of zustandStates) {
          const foundSi = s.stateImages?.find(
            (si) => si.id === selectedStateImageId
          );
          if (foundSi) {
            targetState = s;
            targetStateImageName = foundSi.name;
            break;
          }
        }

        if (!targetState) {
          toast.error("Selected StateImage not found");
          return;
        }

        // Create search region if fixed location is enabled
        const searchRegion: SearchRegion | undefined =
          fixedLocation && extractedResult.bounds
            ? {
                id: `search_region_${Date.now()}`,
                name: "Extraction Region",
                x: extractedResult.bounds.x,
                y: extractedResult.bounds.y,
                width: extractedResult.bounds.width,
                height: extractedResult.bounds.height,
              }
            : undefined;

        // Create new pattern
        const newPattern: Pattern = {
          id: `pattern_${Date.now()}`,
          name: imageName,
          imageId: imageAsset.id,
          searchRegions: searchRegion ? [searchRegion] : [],
          fixed: fixedLocation,
        };

        // Update the StateImage with the new pattern using the LATEST state from Zustand
        const updatedStateImages = targetState.stateImages.map((si) => {
          if (si.id === selectedStateImageId) {
            return {
              ...si,
              patterns: [...(si.patterns || []), newPattern],
            };
          }
          return si;
        });

        const updatedState = {
          ...targetState,
          stateImages: updatedStateImages,
        };

        // IMPORTANT: await to ensure state is persisted before showing success
        await updateState(updatedState);

        if (isNewImage) {
          toast.success(
            `Added pattern to ${targetStateImageName} (image saved to library)`
          );
        } else {
          toast.success(`Added pattern to ${targetStateImageName}`);
        }
      } else {
        // createStateImage mode - original behavior
        // Prepare search region if fixed location is enabled
        const searchRegion =
          fixedLocation && extractedResult.bounds
            ? {
                id: `search_region_${Date.now()}`,
                name: "Extraction Region",
                x: extractedResult.bounds.x,
                y: extractedResult.bounds.y,
                width: extractedResult.bounds.width,
                height: extractedResult.bounds.height,
              }
            : undefined;

        // Create StateImage with imageId referencing the library
        const result = prepareStateImageCreation(
          {
            name: imageName,
            imageId: imageAsset.id,
            source: "image-extraction",
            fixed: fixedLocation,
            searchRegion: searchRegion,
          },
          selectedStateId,
          states,
          newStateName.trim() || undefined
        );

        if (result.action === "create-state" && result.targetState) {
          console.log("[ImageExtraction] Creating new state:", {
            id: result.targetState.id,
            name: result.targetState.name,
            position: result.targetState.position,
            stateImagesCount: result.targetState.stateImages?.length || 0,
          });
          await addState(result.targetState);
          console.log("[ImageExtraction] addState completed");
          toast.success(`Created new state: ${result.targetState.name}`);
        } else if (result.action === "update-state" && result.targetState) {
          console.log("[ImageExtraction] Updating existing state:", {
            id: result.targetState.id,
            name: result.targetState.name,
          });
          await updateState(result.targetState);
          console.log("[ImageExtraction] updateState completed");
          toast.success(`Added StateImage to ${result.targetState.name}`);
        }
      }

      // Reset dialog
      setShowSaveDialog(false);
      setImageName("");
      setSaveMode("createStateImage");
      setSelectedStateId("");
      setNewStateName("");
      setSelectedStateImageId("");
      setExtractedResult(null);
    } catch (error) {
      console.error("Error saving image:", error);
      toast.error("Failed to save image");
    }
  };

  // Region is now always stored in compositeRegion for simplicity
  const activeRegion = compositeRegion;
  const canExtract =
    activeRegion && activeRegion.width > 0 && activeRegion.height > 0;

  // Show loading state while hydrating from IndexedDB
  if (isHydrating && !isHydrated) {
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
            <p className="text-sm text-muted-foreground">
              Loading saved state...
            </p>
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
        {/* Left Panel - Screenshot Info */}
        <div className="w-64 bg-[#27272A]/50 border-r border-gray-800 flex flex-col overflow-y-auto">
          <ScreenshotPicker
            currentScreenshot={
              currentScreenshot
                ? {
                    id: currentScreenshot.id,
                    name: currentScreenshot.name,
                    url: currentScreenshot.url,
                  }
                : null
            }
            onUploadScreenshot={handleUploadScreenshot}
            onCaptureMultipleScreenshots={handleCaptureMultipleScreenshots}
            onSelectProjectScreenshot={handleProjectScreenshotSelect}
            onClearScreenshot={handleClearScreenshot}
            showRegionInfo={true}
            regionDimensions={
              compositeRegion
                ? {
                    width: compositeRegion.width,
                    height: compositeRegion.height,
                  }
                : null
            }
            additionalInfo={
              <div className="bg-[#27272A] rounded-lg p-3 border border-gray-700">
                <h3 className="text-xs font-medium text-gray-300 mb-2">
                  {isCompositeMode ? "Multi-Monitor Mode" : "Instructions"}
                </h3>
                {isCompositeMode ? (
                  <div className="text-xs text-gray-400 space-y-1">
                    <div className="flex items-center gap-1 text-[#00D9FF]">
                      <Monitor className="w-3 h-3" />
                      <span>
                        {compositeScreenshots.length} monitors captured
                      </span>
                    </div>
                    <p>
                      Draw a region across monitors to extract images that span
                      multiple screens.
                    </p>
                  </div>
                ) : (
                  <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                    <li>Draw a selection box on the image</li>
                    <li>Choose processing mode</li>
                    <li>Click "Extract Image"</li>
                    <li>Create StateImage from result</li>
                  </ol>
                )}
              </div>
            }
            className="flex-1 flex flex-col"
          />

          {/* Captured Screenshots Thumbnail Strip */}
          {capturedScreenshots.length > 1 && (
            <div className="p-4 border-t border-gray-800">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-medium text-gray-300">
                  Captured ({capturedScreenshots.length})
                </h3>
                <button
                  onClick={handleClearAllScreenshots}
                  className="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1"
                  title="Clear all captured screenshots"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {capturedScreenshots.map((screenshot) => (
                  <button
                    key={screenshot.id}
                    onClick={() => handleSelectCapturedScreenshot(screenshot)}
                    className={`relative flex-shrink-0 w-16 h-12 rounded border-2 overflow-hidden transition-all ${
                      currentScreenshot?.id === screenshot.id
                        ? "border-[#00D9FF] ring-2 ring-[#00D9FF]/30"
                        : "border-gray-600 hover:border-gray-500"
                    }`}
                    title={screenshot.name}
                  >
                    <img
                      src={screenshot.url}
                      alt={screenshot.name}
                      className="w-full h-full object-cover"
                    />
                    {currentScreenshot?.id === screenshot.id && (
                      <div className="absolute inset-0 bg-[#00D9FF]/20" />
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Click to switch between captured screenshots
              </p>
            </div>
          )}
        </div>

        {/* Middle Panel - Configuration and Viewer */}
        <div className="flex-1 flex h-full">
          {/* Configuration Panel */}
          <div className="w-64 bg-[#27272A]/50 border-r border-gray-800 p-4">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Scissors className="w-4 h-4" />
              Extraction Settings
            </h2>

            <div className="space-y-4">
              {/* Processing Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Processing Mode
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={processingMode === "none"}
                      onChange={() => setProcessingMode("none")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-300">
                      None (Full Region)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={processingMode === "border"}
                      onChange={() => setProcessingMode("border")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-300">Remove Border</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={processingMode === "background"}
                      onChange={() => setProcessingMode("background")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-300">
                      Remove Background
                    </span>
                  </label>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {processingMode === "none" &&
                    "Extract the entire selected region"}
                  {processingMode === "border" &&
                    "Crop out border pixels matching edge color"}
                  {processingMode === "background" &&
                    "Create mask for background pixels and crop"}
                </p>
              </div>

              {/* Tolerance (only for border/background removal) */}
              {processingMode !== "none" && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium text-gray-300">
                      Color Tolerance
                    </label>
                    <span className="text-sm font-mono bg-[#0A0A0B] px-2 py-1 rounded text-gray-300">
                      {tolerance}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Strict</span>
                    <span>Loose</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    How similar colors must be to be considered
                    border/background
                  </p>
                </div>
              )}

              {/* Extract Button */}
              <div className="pt-4">
                <button
                  onClick={handleExtract}
                  disabled={!canExtract}
                  className={`w-full py-2.5 rounded-md font-medium transition-colors ${
                    canExtract
                      ? "bg-[#00FF88] hover:bg-[#00FF88]/90 text-black"
                      : "bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  Extract Image
                </button>

                {!canExtract && currentScreenshot && (
                  <p className="text-xs text-amber-500 flex items-start gap-1 mt-2">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    Select a region on the screenshot first
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Screenshot Viewer */}
          <div className="flex-1 h-full bg-[#0A0A0B]">
            {isCompositeMode && compositeScreenshots.length > 0 ? (
              <CompositeScreenshotCanvas
                screenshots={compositeScreenshots}
                region={compositeRegion ?? undefined}
                onRegionChange={handleCompositeRegionChange}
              />
            ) : currentScreenshot ? (
              <AdvancedRegionSelector
                screenshotId={currentScreenshot.id}
                screenshotUrl={currentScreenshot.url}
                region={compositeRegion ?? undefined}
                onRegionChange={handleRegionChange}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <ImageIcon className="w-12 h-12 mx-auto mb-2" />
                  <p className="text-sm">
                    Upload or select a screenshot to begin
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="w-80 bg-[#27272A]/50 border-l border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-800 flex-shrink-0">
            <h2 className="font-semibold text-white">Extracted Image</h2>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            {extractedResult ? (
              <div className="space-y-4">
                {/* Extracted Image */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2">
                    Image
                  </h3>
                  <div
                    className="border border-gray-700 rounded p-2"
                    style={{
                      background: `
                        linear-gradient(45deg, #f3f4f6 25%, transparent 25%),
                        linear-gradient(-45deg, #f3f4f6 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #f3f4f6 75%),
                        linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)
                      `,
                      backgroundSize: "10px 10px",
                      backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
                      backgroundColor: "#ffffff",
                    }}
                  >
                    <img
                      src={extractedResult.croppedImage}
                      alt="Extracted"
                      className="w-full h-auto"
                      style={{ maxHeight: "300px", objectFit: "contain" }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {extractedResult.bounds.width}×
                    {extractedResult.bounds.height} pixels
                  </p>
                </div>

                {/* Mask (if available) */}
                {extractedResult.mask && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                      Mask
                    </h3>
                    <div className="border border-gray-700 rounded bg-[#0A0A0B] p-2">
                      <img
                        src={extractedResult.mask}
                        alt="Mask"
                        className="w-full h-auto"
                        style={{ maxHeight: "200px", objectFit: "contain" }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      White = included, Black = masked
                    </p>
                  </div>
                )}

                {/* Info */}
                <div className="bg-[#00D9FF]/10 border border-[#00D9FF] rounded-md p-3">
                  <h4 className="text-sm font-medium text-white mb-1">
                    Processing Info
                  </h4>
                  <ul className="text-xs text-gray-300 space-y-1">
                    <li>
                      Mode:{" "}
                      {processingMode === "none"
                        ? "Full Region"
                        : processingMode === "border"
                          ? "Border Removed"
                          : "Background Removed"}
                    </li>
                    {processingMode !== "none" && (
                      <li>Tolerance: {tolerance}</li>
                    )}
                    {compositeRegion && (
                      <li>
                        Original bounds: {Math.round(compositeRegion.x)},{" "}
                        {Math.round(compositeRegion.y)}
                      </li>
                    )}
                    <li>
                      Cropped bounds: {extractedResult.bounds.x},{" "}
                      {extractedResult.bounds.y}
                    </li>
                  </ul>
                </div>

                {/* Action Buttons */}
                <div className="space-y-2">
                  <button
                    onClick={handleEditMask}
                    className="w-full px-4 py-2.5 bg-[#BD00FF] text-white rounded-md hover:bg-[#BD00FF]/90 font-medium flex items-center justify-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Edit Mask
                  </button>
                  <button
                    onClick={() => setShowSaveDialog(true)}
                    className="w-full px-4 py-2.5 bg-[#00FF88] text-black rounded-md hover:bg-[#00FF88]/90 font-medium flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Save Image
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="mb-3">
                  <div className="w-16 h-16 mx-auto bg-[#27272A] rounded-full flex items-center justify-center">
                    <Scissors className="w-8 h-8 text-gray-600" />
                  </div>
                </div>
                <p className="font-medium text-white">No Image Extracted</p>
                <p className="text-sm text-gray-400 mt-1">
                  Select a region and click Extract
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save Image Dialog */}
      {showSaveDialog && extractedResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div
            className="bg-[#27272A] border border-gray-700 rounded-lg p-6 w-[450px] max-w-full max-h-[90vh] overflow-y-auto"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey
              ) {
                const target = e.target as HTMLElement;
                if (
                  target.tagName !== "TEXTAREA" &&
                  target.tagName !== "BUTTON"
                ) {
                  e.preventDefault();
                  handleSaveImage();
                }
              }
            }}
          >
            <h3 className="text-lg font-semibold text-white mb-4">
              Save Extracted Image
            </h3>

            <div className="space-y-4">
              {/* Image Name - always required */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Image Name
                </label>
                <input
                  type="text"
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  placeholder="Enter a name for the image"
                  className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
                />
              </div>

              {/* Save Mode Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Save As
                </label>
                <div className="space-y-2">
                  <label className="flex items-start p-3 bg-[#0A0A0B] border border-gray-700 rounded-md cursor-pointer hover:border-gray-600 transition-colors">
                    <input
                      type="radio"
                      checked={saveMode === "createStateImage"}
                      onChange={() => setSaveMode("createStateImage")}
                      className="mt-0.5 mr-3"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Plus className="w-4 h-4 text-[#00FF88]" />
                        <span className="text-sm font-medium text-white">
                          Create StateImage
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Create a new StateImage and add it to a state
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start p-3 bg-[#0A0A0B] border border-gray-700 rounded-md cursor-pointer hover:border-gray-600 transition-colors">
                    <input
                      type="radio"
                      checked={saveMode === "addPattern"}
                      onChange={() => setSaveMode("addPattern")}
                      className="mt-0.5 mr-3"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-[#BD00FF]" />
                        <span className="text-sm font-medium text-white">
                          Add Pattern to StateImage
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Add as a pattern variation to an existing StateImage
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start p-3 bg-[#0A0A0B] border border-gray-700 rounded-md cursor-pointer hover:border-gray-600 transition-colors">
                    <input
                      type="radio"
                      checked={saveMode === "libraryOnly"}
                      onChange={() => setSaveMode("libraryOnly")}
                      className="mt-0.5 mr-3"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Library className="w-4 h-4 text-[#00D9FF]" />
                        <span className="text-sm font-medium text-white">
                          Save to Library Only
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Save to the image library without creating a StateImage
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Conditional fields based on save mode */}
              {saveMode === "createStateImage" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Add to State
                    </label>
                    <select
                      value={selectedStateId}
                      onChange={(e) => setSelectedStateId(e.target.value)}
                      className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
                    >
                      <option value="">Select a state...</option>
                      <option value="new">Create New State</option>
                      {states.map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedStateId === "new" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        New State Name
                      </label>
                      <input
                        type="text"
                        value={newStateName}
                        onChange={(e) => setNewStateName(e.target.value)}
                        placeholder="Enter name for the new state"
                        className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
                      />
                    </div>
                  )}
                </>
              )}

              {saveMode === "addPattern" && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Add Pattern to StateImage
                  </label>
                  <select
                    value={selectedStateImageId}
                    onChange={(e) => setSelectedStateImageId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
                  >
                    <option value="">Select a StateImage...</option>
                    {allStateImages.map((ctx) => {
                      const patternCount = ctx.stateImage.patterns?.length || 0;
                      return (
                        <option
                          key={ctx.stateImage.id}
                          value={ctx.stateImage.id}
                        >
                          {ctx.stateImage.name} ({ctx.stateName}) -{" "}
                          {patternCount} pattern
                          {patternCount !== 1 ? "s" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {allStateImages.length === 0 && (
                    <p className="text-xs text-amber-500 mt-1">
                      No StateImages exist yet. Create a StateImage first.
                    </p>
                  )}
                </div>
              )}

              {/* Fixed location checkbox - shown for StateImage and Pattern modes */}
              {saveMode !== "libraryOnly" && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="fixed-location"
                    checked={fixedLocation}
                    onChange={(e) => setFixedLocation(e.target.checked)}
                    className="h-4 w-4 text-[#00D9FF] focus:ring-[#00D9FF] border-gray-700 rounded"
                  />
                  <label
                    htmlFor="fixed-location"
                    className="ml-2 block text-sm text-gray-300"
                  >
                    Fixed location (saves extraction region as search region)
                  </label>
                </div>
              )}

              {/* Mask info */}
              {extractedResult.mask && (
                <div className="text-sm text-[#00D9FF] bg-[#00D9FF]/10 border border-[#00D9FF] p-2 rounded">
                  Mask will be saved with the image
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setImageName("");
                  setSaveMode("createStateImage");
                  setSelectedStateId("");
                  setNewStateName("");
                  setSelectedStateImageId("");
                }}
                className="px-4 py-2 text-sm text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveImage}
                disabled={
                  !imageName ||
                  (saveMode === "createStateImage" &&
                    (!selectedStateId ||
                      (selectedStateId === "new" && !newStateName.trim()))) ||
                  (saveMode === "addPattern" && !selectedStateImageId)
                }
                className="px-4 py-2 text-sm text-black bg-[#00FF88] rounded-md hover:bg-[#00FF88]/90 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {saveMode === "libraryOnly"
                  ? "Save to Library"
                  : saveMode === "addPattern"
                    ? "Add Pattern"
                    : "Create StateImage"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mask Editor */}
      {showMaskEditor && editingMask && (
        <MaskEditor
          imageUrl={editingMask.imageUrl}
          initialMask={editingMask.initialMask}
          onSave={handleSaveMask}
          onCancel={() => {
            setShowMaskEditor(false);
            setEditingMask(null);
          }}
          open={showMaskEditor}
        />
      )}
    </div>
  );
};
