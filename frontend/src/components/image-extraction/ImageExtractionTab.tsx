import React, { useState, useEffect, useMemo } from "react";
import {
  Scissors,
  ImageIcon,
  Plus,
  AlertCircle,
  Edit,
  Library,
  Layers,
} from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { useImageExtractionState } from "@/contexts/tab-state";
import { ScreenshotPicker } from "../common/ScreenshotPicker";
import { AdvancedRegionSelector } from "../pattern-optimization/AdvancedRegionSelector";
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

interface Screenshot {
  id: string;
  name: string;
  url: string;
  region?: Region;
}

type ProcessingMode = "none" | "border" | "background";
type SaveMode = "createStateImage" | "addPattern" | "libraryOnly";

// Helper to flatten all StateImages with their parent state info
interface StateImageWithContext {
  stateImage: StateImage;
  stateId: string;
  stateName: string;
}

export const ImageExtractionTab: React.FC = () => {
  const [currentScreenshot, setCurrentScreenshot] = useState<Screenshot | null>(
    null
  );
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("none");
  const [tolerance, setTolerance] = useState(10);
  const [extractedResult, setExtractedResult] =
    useState<ProcessedImageResult | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>("createStateImage");
  const [imageName, setImageName] = useState("");
  const [selectedStateId, setSelectedStateId] = useState<string>("");
  const [newStateName, setNewStateName] = useState("");
  const [selectedStateImageId, setSelectedStateImageId] = useState<string>("");
  const [fixedLocation, setFixedLocation] = useState(true);
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [editingMask, setEditingMask] = useState<{
    imageUrl: string;
    initialMask?: string;
  } | null>(null);

  const {
    states,
    addState,
    updateState,
    screenshots: projectScreenshots,
    images,
    addImage,
  } = useAutomation();
  const { state: persistedState, setState: setPersistedState } =
    useImageExtractionState();

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

  // Load persisted state on mount
  useEffect(() => {
    if (persistedState.selectedStateId) {
      setSelectedStateId(persistedState.selectedStateId);
    }

    if (persistedState.newStateName) {
      setNewStateName(persistedState.newStateName);
    }

    // Note: We don&apos;t persist screenshots due to storage limitations
    // Users will need to re-upload when navigating back
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist state changes (only metadata, not images)
  useEffect(() => {
    setPersistedState({
      selectedRegion: currentScreenshot?.region || null,
      selectedStateId,
      newStateName,
    });
  }, [
    currentScreenshot?.region,
    selectedStateId,
    newStateName,
    setPersistedState,
  ]);

  const handleUploadScreenshot = (file: File) => {
    const url = URL.createObjectURL(file);

    setCurrentScreenshot({
      id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      url,
    });

    // Reset extracted result when new screenshot is loaded
    setExtractedResult(null);
  };

  const handleProjectScreenshotSelect = async (screenshotId: string) => {
    const projectScreenshot = projectScreenshots.find(
      (s) => s.id === screenshotId
    );
    if (projectScreenshot && projectScreenshot.url) {
      setCurrentScreenshot({
        id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: projectScreenshot.name,
        url: projectScreenshot.url,
      });

      // Reset extracted result when new screenshot is loaded
      setExtractedResult(null);
    } else {
      console.warn(
        "[ImageExtractionTab] Project screenshot missing URL:",
        screenshotId
      );
      toast.error("Selected screenshot has no image URL");
    }
  };

  const handleClearScreenshot = () => {
    setCurrentScreenshot(null);
    setExtractedResult(null);
  };

  const handleRegionChange = (region: Region) => {
    if (currentScreenshot) {
      setCurrentScreenshot({
        ...currentScreenshot,
        region,
      });
    }
  };

  const handleExtract = async () => {
    if (!currentScreenshot?.region) {
      toast.error("Please select a region first");
      return;
    }

    try {
      let result: ProcessedImageResult;

      if (processingMode === "none") {
        result = await extractRegion(
          currentScreenshot.url,
          currentScreenshot.region
        );
      } else if (processingMode === "border") {
        result = await removeBorder(
          currentScreenshot.url,
          currentScreenshot.region,
          tolerance
        );
      } else {
        result = await removeBackground(
          currentScreenshot.url,
          currentScreenshot.region,
          tolerance
        );
      }

      setExtractedResult(result);
      toast.success("Image extracted successfully");
    } catch (error) {
      console.error("Extraction failed:", error);
      toast.error("Failed to extract image");
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
        addImage(imageAsset);
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
        const stateImageContext = allStateImages.find(
          (ctx) => ctx.stateImage.id === selectedStateImageId
        );

        if (!stateImageContext) {
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

        // Find the state and update the StateImage with the new pattern
        const state = states.find((s) => s.id === stateImageContext.stateId);
        if (state) {
          const updatedStateImages = state.stateImages.map((si) => {
            if (si.id === selectedStateImageId) {
              return {
                ...si,
                patterns: [...si.patterns, newPattern],
              };
            }
            return si;
          });

          updateState({
            ...state,
            stateImages: updatedStateImages,
          });

          if (isNewImage) {
            toast.success(
              `Added pattern to ${stateImageContext.stateImage.name} (image saved to library)`
            );
          } else {
            toast.success(
              `Added pattern to ${stateImageContext.stateImage.name}`
            );
          }
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
          addState(result.targetState);
          toast.success(`Created new state: ${result.targetState.name}`);
        } else if (result.action === "update-state" && result.targetState) {
          updateState(result.targetState);
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

  const canExtract =
    currentScreenshot?.region &&
    currentScreenshot.region.width > 0 &&
    currentScreenshot.region.height > 0;

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
            onSelectProjectScreenshot={handleProjectScreenshotSelect}
            onClearScreenshot={handleClearScreenshot}
            showRegionInfo={true}
            regionDimensions={
              currentScreenshot?.region
                ? {
                    width: currentScreenshot.region.width,
                    height: currentScreenshot.region.height,
                  }
                : null
            }
            additionalInfo={
              <div className="bg-[#27272A] rounded-lg p-3 border border-gray-700">
                <h3 className="text-xs font-medium text-gray-300 mb-2">
                  Instructions
                </h3>
                <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Draw a selection box on the image</li>
                  <li>Choose processing mode</li>
                  <li>Click "Extract Image"</li>
                  <li>Create StateImage from result</li>
                </ol>
              </div>
            }
            className="flex-1 flex flex-col"
          />
        </div>

        {/* Middle Panel - Configuration and Viewer */}
        <div className="flex-1 flex">
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
          <div className="flex-1 bg-[#0A0A0B]">
            {currentScreenshot ? (
              <AdvancedRegionSelector
                screenshotId={currentScreenshot.id}
                screenshotUrl={currentScreenshot.url}
                region={currentScreenshot.region}
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
                    {currentScreenshot?.region && (
                      <li>
                        Original bounds:{" "}
                        {Math.round(currentScreenshot.region.x)},{" "}
                        {Math.round(currentScreenshot.region.y)}
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
          <div className="bg-[#27272A] border border-gray-700 rounded-lg p-6 w-[450px] max-w-full max-h-[90vh] overflow-y-auto">
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
                    {allStateImages.map((ctx) => (
                      <option key={ctx.stateImage.id} value={ctx.stateImage.id}>
                        {ctx.stateImage.name} ({ctx.stateName}) -{" "}
                        {ctx.stateImage.patterns.length} pattern
                        {ctx.stateImage.patterns.length !== 1 ? "s" : ""}
                      </option>
                    ))}
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
