import React, { useState, useEffect, useRef } from "react";
import {
  PatternOptimizationProvider,
  usePatternOptimization,
} from "@/contexts/pattern-optimization-context-simplified";
import {
  ExtractionConfig,
  PatternQuality,
  Region,
} from "@/types/pattern-optimization";
import { AdvancedRegionSelector } from "./AdvancedRegionSelector";
import {
  Upload,
  X,
  Sliders,
  AlertCircle,
  Check,
  ImageIcon,
  MousePointer,
  Edit2,
  Eraser,
  Plus,
  FolderOpen,
} from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import type { StateImage } from "@/contexts/automation-context/types";
import { ScreenshotSelector } from "../screenshot-selector";
import { prepareStateImageCreation } from "@/lib/state-image-creator";
import {
  createImageAsset,
  imageExistsInLibrary,
} from "@/lib/image-library-utils";
import { toast } from "sonner";

/**
 * Pattern Optimization Component - Simplified
 * Single Responsibility: UI for pattern extraction from screenshots
 */
const PatternOptimizationContent: React.FC = () => {
  const {
    session,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    setScreenshotRegion,
    setAllScreenshotRegions,
    extractPattern,
    isExtracting,
    extractedPattern,
    analyzePatternQuality,
  } = usePatternOptimization();

  const [config, setConfig] = useState<ExtractionConfig>({
    similarityThreshold: 0.85,
    colorAveraging: "weighted",
    morphologicalOps: {
      enabled: true,
      erosionSize: 1,
      dilationSize: 2,
    },
    minActivePixels: 100,
  });

  const [selectedScreenshotId, setSelectedScreenshotId] = useState<
    string | null
  >(null);
  const [patternQuality, setPatternQuality] = useState<PatternQuality | null>(
    null
  );
  const [editMode, setEditMode] = useState<"none" | "add" | "remove">("none");
  const [editedPattern, setEditedPattern] = useState<string | null>(null);
  const [showStateImageDialog, setShowStateImageDialog] = useState(false);
  const [showScreenshotSelector, setShowScreenshotSelector] = useState(false);
  const [stateImageName, setStateImageName] = useState("");
  const [selectedStateId, setSelectedStateId] = useState<string>("");
  const [newStateName, setNewStateName] = useState("");
  const [fixedLocation, setFixedLocation] = useState(true);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const patternCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);
  const {
    states,
    addState,
    updateState,
    screenshots: projectScreenshots,
    images,
    addImage,
  } = useAutomation();

  const BRUSH_RADIUS = 5; // Smaller brush size

  // Initialize session on mount and select first screenshot
  useEffect(() => {
    if (!session) {
      createSession();
    } else if (session.screenshots?.length > 0 && !selectedScreenshotId) {
      const firstScreenshot = session.screenshots[0];
      if (firstScreenshot) {
        setSelectedScreenshotId(firstScreenshot.id);
      }
    }
  }, [session, createSession, selectedScreenshotId]);

  // Analyze pattern quality when extracted
  useEffect(() => {
    if (extractedPattern) {
      const quality = analyzePatternQuality(extractedPattern);
      setPatternQuality(quality);
    }
  }, [extractedPattern, analyzePatternQuality]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await addScreenshots(files);
      // Select first screenshot after adding if none selected
      setTimeout(() => {
        if (!selectedScreenshotId && session?.screenshots?.length > 0) {
          const firstScreenshot = session.screenshots[0];
          if (firstScreenshot) {
            setSelectedScreenshotId(firstScreenshot.id);
          }
        }
      }, 100);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleProjectScreenshotSelect = async (screenshotIds: string[]) => {
    // Convert all selected screenshots
    const files: File[] = [];
    for (const screenshotId of screenshotIds) {
      const projectScreenshot = projectScreenshots.find(
        (s) => s.id === screenshotId
      );
      if (projectScreenshot) {
        const file = await urlToFile(
          projectScreenshot.url,
          projectScreenshot.name
        );
        files.push(file);
      }
    }

    if (files.length > 0) {
      await addScreenshots(files);

      // Select the first newly added screenshot
      setTimeout(() => {
        if (session?.screenshots?.length > 0) {
          const targetScreenshot = session.screenshots[session.screenshots.length - files.length];
          if (targetScreenshot) {
            setSelectedScreenshotId(targetScreenshot.id);
          }
        }
      }, 100);
    }

    setShowScreenshotSelector(false);
  };

  // Helper function to convert data URL to File object
  const urlToFile = async (url: string, filename: string): Promise<File> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type });
  };

  const handleExtract = async () => {
    console.log("[PatternOptimization] Extract clicked");
    console.log("[PatternOptimization] Session:", session);
    console.log(
      "[PatternOptimization] Screenshots with regions:",
      session?.screenshots.filter((s) => s.region)
    );
    console.log("[PatternOptimization] Can extract?", canExtract);

    if (!canExtract) {
      console.log(
        "[PatternOptimization] Cannot extract - missing requirements"
      );
      return;
    }

    try {
      await extractPattern(config);
    } catch (error) {
      console.error("Pattern extraction failed:", error);
      // Don't show alert, let the error be handled gracefully
    }
  };

  const handleRegionChange = (region: Region) => {
    console.log("[PatternOptimization] Region changed:", region);
    // Apply region to all screenshots automatically using batch update
    setAllScreenshotRegions(region);

    // Force a re-render to update canExtract
    setTimeout(() => {
      console.log("[PatternOptimization] After region update - checking state");
      console.log(
        "[PatternOptimization] Session screenshots:",
        session?.screenshots
      );
    }, 100);
  };

  const selectedScreenshot = session?.screenshots.find(
    (s) => s.id === selectedScreenshotId
  );

  // Check if we can extract - need at least one screenshot with a region
  const hasRegions = session?.screenshots?.some((s) => s.region) || false;
  const hasRequirements =
    session && session.screenshots.length > 0 && hasRegions;

  const canExtract = hasRequirements && !isExtracting;

  // Debug logging
  useEffect(() => {
    if (session) {
      console.log("[PatternOptimization] Session updated, checking regions:");
      session.screenshots.forEach((s) => {
        console.log(
          `  - ${s.id}: ${s.region ? "has region" : "no region"}`,
          s.region
        );
      });
      console.log("[PatternOptimization] Can extract?", canExtract);
    }
  }, [session, canExtract]);

  // Initialize pattern canvas when entering edit mode
  useEffect(() => {
    if (
      editMode !== "none" &&
      extractedPattern?.patternImage &&
      patternCanvasRef.current
    ) {
      const canvas = patternCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw checkerboard background for transparency
      const checkSize = 5;
      for (let y = 0; y < canvas.height; y += checkSize) {
        for (let x = 0; x < canvas.width; x += checkSize) {
          ctx.fillStyle =
            (x / checkSize + y / checkSize) % 2 === 0 ? "#f3f4f6" : "#ffffff";
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }

      // Draw the pattern image
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = editedPattern || extractedPattern.patternImage;
    }
  }, [editMode, extractedPattern, editedPattern]);

  const getQualityColor = (rating: PatternQuality["rating"]) => {
    switch (rating) {
      case "excellent":
        return "text-green-600 bg-green-50 border-green-200";
      case "good":
        return "text-blue-600 bg-blue-50 border-blue-200";
      case "fair":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case "poor":
        return "text-red-600 bg-red-50 border-red-200";
    }
  };

  const handlePatternMouseMove = (
    event: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if (!patternCanvasRef.current) return;

    const canvas = patternCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    setCursorPos({ x, y });

    // Handle dragging
    if (event.buttons === 1 && editMode !== "none") {
      handlePatternEdit(event);
    }
  };

  const handlePatternMouseLeave = () => {
    setCursorPos(null);
  };

  const handlePatternEdit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (editMode === "none" || !patternCanvasRef.current || !extractedPattern)
      return;

    const canvas = patternCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(
      (event.clientX - rect.left) * (canvas.width / rect.width)
    );
    const y = Math.floor(
      (event.clientY - rect.top) * (canvas.height / rect.height)
    );

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get the current image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Create a circular brush
    for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
      for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
        if (dx * dx + dy * dy <= BRUSH_RADIUS * BRUSH_RADIUS) {
          const px = x + dx;
          const py = y + dy;

          if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height) {
            const index = (py * canvas.width + px) * 4;

            if (editMode === "add") {
              // Add transparency (make pixels transparent)
              imageData.data[index + 3] = 0; // Set alpha to 0
            } else if (editMode === "remove") {
              // Remove transparency (make pixels opaque)
              // Restore pixels from original pattern if available
              if (imageData.data[index + 3] === 0) {
                // Only fill if currently transparent
                imageData.data[index] = 128; // R
                imageData.data[index + 1] = 128; // G
                imageData.data[index + 2] = 128; // B
                imageData.data[index + 3] = 255; // A
              }
            }
          }
        }
      }
    }

    // Put the modified image data back
    ctx.putImageData(imageData, 0, 0);

    // Save the edited pattern
    setEditedPattern(canvas.toDataURL());
  };

  const handleCreateStateImage = async () => {
    if (!extractedPattern || !stateImageName) {
      toast.error("Missing required fields");
      return;
    }

    // Validate new state name when creating a new state
    if (selectedStateId === "new" && !newStateName.trim()) {
      toast.error("Please enter a name for the new state");
      return;
    }

    try {
      const imageData = editedPattern || extractedPattern.patternImage || "";

      // If fixed location is enabled, get the first screenshot's region as the search region
      let searchRegion:
        | {
            id: string;
            name: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }
        | undefined;
      if (fixedLocation && session?.screenshots?.length > 0) {
        const firstScreenshot = session.screenshots[0];
        if (firstScreenshot?.region) {
          searchRegion = {
            id: `search_region_${Date.now()}`,
            name: "Pattern Region",
            x: firstScreenshot.region.x,
            y: firstScreenshot.region.y,
            width: firstScreenshot.region.width,
            height: firstScreenshot.region.height,
          };
        }
      }

      const result = prepareStateImageCreation(
        {
          name: stateImageName,
          image: imageData,
          mask: extractedPattern.maskImage,
          source: "pattern-optimization",
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

      // Add image to Image Library (avoid duplicates)
      if (!imageExistsInLibrary(images, imageData)) {
        const imageAsset = createImageAsset(
          imageData,
          stateImageName,
          "pattern_optimization"
        );
        addImage(imageAsset);
        toast.success("Added to Image Library");
      }

      // Reset dialog
      setShowStateImageDialog(false);
      setStateImageName("");
      setSelectedStateId("");
      setNewStateName("");
    } catch (error) {
      console.error("Error creating StateImage:", error);
      toast.error("Failed to create StateImage");
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0A0A0B]">
      {/* Header */}
      <div className="bg-[#27272A] border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold text-white">Pattern Extraction</h1>
        <p className="text-gray-500 mt-1">
          Upload screenshots, select regions, and extract robust patterns for UI
          automation
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Screenshots */}
        <div className="w-64 bg-[#27272A]/50 border-r border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-white">Screenshots</h2>
              {(session?.screenshots?.length ?? 0) > 0 && (
                <button
                  onClick={clearSession}
                  className="px-3 py-1.5 bg-red-500/90 text-white rounded-md hover:bg-red-600 text-sm"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-3 py-1.5 bg-[#00D9FF] text-black rounded-md hover:bg-[#00D9FF]/90 font-medium text-sm flex items-center justify-center gap-1"
                title="Upload new screenshots from your computer"
              >
                <Upload className="w-4 h-4" />
                Upload
              </button>
              <button
                onClick={() => screenshotSelectorTriggerRef.current?.click()}
                className="flex-1 px-3 py-1.5 bg-[#00FF88] text-black rounded-md hover:bg-[#00FF88]/90 font-medium text-sm flex items-center justify-center gap-1"
                title="Select screenshots from project"
              >
                <FolderOpen className="w-4 h-4" />
                Project
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Screenshot List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              {session?.screenshots.map((screenshot) => (
                <div
                  key={screenshot.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-all ${
                    selectedScreenshotId === screenshot.id
                      ? "border-[#00D9FF] bg-[#00D9FF]/10 shadow-sm"
                      : "border-gray-700 hover:bg-[#27272A]/80"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div
                      className="flex-1"
                      onClick={() => {
                        setSelectedScreenshotId(screenshot.id);
                      }}
                    >
                      <div className="font-medium text-sm text-white truncate">
                        {screenshot.name}
                      </div>
                      {screenshot.region ? (
                        <div className="text-xs text-[#00FF88] mt-1 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Region: {Math.round(screenshot.region.width)}×
                          {Math.round(screenshot.region.height)}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                          <MousePointer className="w-3 h-3" />
                          Click to select region
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeScreenshot(screenshot.id);
                      }}
                      className="p-1 hover:bg-gray-700 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {session?.screenshots.length === 0 && (
              <div className="text-center py-8">
                <ImageIcon className="w-12 h-12 mx-auto mb-2 text-gray-500" />
                <p className="text-sm text-gray-500">No screenshots uploaded</p>
                <p className="text-xs text-gray-500 mt-1">
                  Click "Add" to upload screenshots
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Middle Panel - Configuration and Screenshot Viewer */}
        <div className="flex-1 flex">
          {/* Configuration Panel */}
          <div className="w-64 bg-[#27272A]/50 border-r border-gray-800 p-4">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              Extraction Configuration
            </h2>

            <div className="space-y-4">
              {/* Similarity Threshold */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-gray-300">
                    Similarity Threshold
                  </label>
                  <span className="text-sm font-mono bg-[#0A0A0B] px-2 py-1 rounded text-gray-300">
                    {(config.similarityThreshold * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={config.similarityThreshold * 100}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      similarityThreshold: Number(e.target.value) / 100,
                    }))
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>More inclusive</span>
                  <span>More strict</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Pixels with confidence below this threshold will be masked out
                </p>
              </div>

              {/* Color Averaging */}
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-2">
                  Color Averaging Method
                </label>
                <select
                  value={config.colorAveraging}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      colorAveraging: e.target.value as any,
                    }))
                  }
                  className="w-full bg-[#0A0A0B] border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
                >
                  <option value="mean">Mean (Simple Average)</option>
                  <option value="median">Median (Robust to Outliers)</option>
                  <option value="weighted">Weighted by Confidence</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  {config.colorAveraging === "weighted"
                    ? "Pixels are weighted by their stability across screenshots"
                    : config.colorAveraging === "median"
                      ? "Uses the middle value, ignoring extreme variations"
                      : "Simple average of all pixel values"}
                </p>
              </div>

              {/* Morphological Operations */}
              <div>
                <label className="flex items-center text-sm font-medium text-gray-300">
                  <input
                    type="checkbox"
                    checked={config.morphologicalOps.enabled}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        morphologicalOps: {
                          ...prev.morphologicalOps,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                    className="mr-2"
                  />
                  Clean Mask
                </label>
                {config.morphologicalOps.enabled && (
                  <div className="mt-3 ml-6 space-y-3">
                    <div>
                      <label className="text-xs text-gray-500">
                        Erosion (remove noise)
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="5"
                        value={config.morphologicalOps.erosionSize}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            morphologicalOps: {
                              ...prev.morphologicalOps,
                              erosionSize: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">
                        Dilation (fill gaps)
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="5"
                        value={config.morphologicalOps.dilationSize}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            morphologicalOps: {
                              ...prev.morphologicalOps,
                              dilationSize: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Removes small isolated pixels and fills small gaps in the mask
                </p>
              </div>

              {/* Extract Button */}
              <div className="pt-4">
                <button
                  onClick={handleExtract}
                  disabled={!canExtract}
                  className={`w-full py-2.5 rounded-md font-medium transition-colors ${
                    canExtract
                      ? "bg-[#00FF88] hover:bg-[#00FF88]/90 text-black"
                      : "bg-gray-200 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {isExtracting ? "Extracting..." : "Extract Pattern"}
                </button>

                {!hasRequirements &&
                  (session?.screenshots?.length ?? 0) > 0 &&
                  !isExtracting && (
                    <p className="text-xs text-amber-500 flex items-start gap-1 mt-2">
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      Draw a selection box on the screenshot to define the
                      pattern region
                    </p>
                  )}
              </div>
            </div>
          </div>

          {/* Screenshot Viewer */}
          <div className="flex-1 bg-[#0A0A0B]">
            {selectedScreenshot ? (
              <AdvancedRegionSelector
                screenshotId={selectedScreenshot.id}
                screenshotUrl={selectedScreenshot.url}
                region={selectedScreenshot.region}
                onRegionChange={handleRegionChange}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <ImageIcon className="w-12 h-12 mx-auto mb-2" />
                  <p className="text-sm">Upload screenshots to begin</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="w-80 bg-[#27272A]/50 border-l border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-800 flex-shrink-0">
            <h2 className="font-semibold text-white">Extraction Results</h2>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            {extractedPattern ? (
              <div className="space-y-4">
                {/* Pattern Info */}
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-white">
                      {extractedPattern.name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {extractedPattern.width}×{extractedPattern.height} pixels
                    </p>
                  </div>
                  <button
                    onClick={() => setShowStateImageDialog(true)}
                    className="px-3 py-1.5 bg-[#00FF88] text-black rounded-md hover:bg-[#00FF88]/90 font-medium text-sm flex items-center gap-1"
                    title="Create a StateImage from this pattern"
                  >
                    <Plus className="w-4 h-4" />
                    StateImage
                  </button>
                </div>

                {/* Quality Badge */}
                {patternQuality && (
                  <div
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border ${getQualityColor(patternQuality.rating)}`}
                  >
                    {patternQuality.rating.toUpperCase()} (
                    {patternQuality.score}/100)
                  </div>
                )}

                {/* Pattern Images */}
                <div className="space-y-3">
                  {/* Pattern Editing Tools - Moved above Pattern */}
                  <div className="bg-[#27272A] rounded-lg p-3 border border-gray-700">
                    <h4 className="text-xs font-medium text-gray-300 mb-2">
                      Edit Transparency
                    </h4>
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() =>
                          setEditMode(editMode === "add" ? "none" : "add")
                        }
                        className={`px-2 py-1 text-xs rounded ${
                          editMode === "add"
                            ? "bg-blue-500 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                        title="Add transparency (make pixels transparent)"
                      >
                        <Edit2 className="w-3 h-3 inline mr-1" />
                        Add
                      </button>
                      <button
                        onClick={() =>
                          setEditMode(editMode === "remove" ? "none" : "remove")
                        }
                        className={`px-2 py-1 text-xs rounded ${
                          editMode === "remove"
                            ? "bg-green-500 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                        title="Remove transparency (make pixels opaque)"
                      >
                        <Eraser className="w-3 h-3 inline mr-1" />
                        Remove
                      </button>
                      {editedPattern && (
                        <button
                          onClick={() => setEditedPattern(null)}
                          className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                          title="Reset to original pattern"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {editMode === "add" &&
                        "Click or drag on the pattern below to add transparency (make areas transparent)"}
                      {editMode === "remove" &&
                        "Click or drag on the pattern below to remove transparency (make areas opaque)"}
                      {editMode === "none" &&
                        "Select Add or Remove to edit transparency in the pattern below"}
                    </div>
                  </div>

                  <div>
                    <h4
                      className="text-xs font-medium text-gray-300 mb-1 cursor-help"
                      title="The final extracted pattern. Only pixels that passed the confidence threshold (shown as white in the mask) are included. Pixels with low confidence (black in mask) are made transparent, creating a pattern that focuses on stable, consistent elements while ignoring variable parts like text or changing UI elements."
                    >
                      Pattern
                    </h4>
                    <div className="relative">
                      {editMode !== "none" ? (
                        // Show editable canvas when in edit mode
                        <>
                          <canvas
                            ref={patternCanvasRef}
                            width={extractedPattern.width}
                            height={extractedPattern.height}
                            className="w-full h-auto border rounded cursor-crosshair"
                            onClick={handlePatternEdit}
                            onMouseMove={handlePatternMouseMove}
                            onMouseLeave={handlePatternMouseLeave}
                            style={{
                              imageRendering: "pixelated",
                              maxHeight: "300px",
                              objectFit: "contain",
                            }}
                          />
                          {/* Cursor indicator overlay */}
                          {cursorPos &&
                            editMode !== "none" &&
                            patternCanvasRef.current && (
                              <div
                                className="absolute pointer-events-none border-2 rounded-full"
                                style={{
                                  left: `${(cursorPos.x / extractedPattern.width) * 100}%`,
                                  top: `${(cursorPos.y / extractedPattern.height) * 100}%`,
                                  width: `${(BRUSH_RADIUS * 2 + 1) * (patternCanvasRef.current.getBoundingClientRect().width / extractedPattern.width)}px`,
                                  height: `${(BRUSH_RADIUS * 2 + 1) * (patternCanvasRef.current.getBoundingClientRect().height / extractedPattern.height)}px`,
                                  transform: "translate(-50%, -50%)",
                                  borderColor:
                                    editMode === "add" ? "#3b82f6" : "#10b981",
                                  opacity: 0.8,
                                }}
                              />
                            )}
                        </>
                      ) : (
                        // Show static pattern when not editing
                        <div
                          className="border rounded p-2"
                          style={{
                            background: `
                              linear-gradient(45deg, #f3f4f6 25%, transparent 25%),
                              linear-gradient(-45deg, #f3f4f6 25%, transparent 25%),
                              linear-gradient(45deg, transparent 75%, #f3f4f6 75%),
                              linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)
                            `,
                            backgroundSize: "10px 10px",
                            backgroundPosition:
                              "0 0, 0 5px, 5px -5px, -5px 0px",
                            backgroundColor: "#ffffff",
                          }}
                        >
                          {editedPattern || extractedPattern.patternImage ? (
                            <img
                              src={
                                editedPattern || extractedPattern.patternImage
                              }
                              alt="Pattern"
                              className="w-full h-auto"
                              style={{
                                maxHeight: "300px",
                                objectFit: "contain",
                              }}
                            />
                          ) : (
                            <div className="h-24 flex items-center justify-center text-gray-500 text-xs bg-gray-50 rounded">
                              No image
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <h4
                        className="text-xs font-medium text-gray-300 mb-1 cursor-help"
                        title="Shows pixel consistency across screenshots. Brighter areas (white) indicate high similarity between screenshots - these pixels are stable. Darker areas (black) show high variation - these pixels change between screenshots."
                      >
                        Confidence Map
                      </h4>
                      <div className="border rounded bg-gray-50 p-2">
                        {extractedPattern.confidenceMap ? (
                          <img
                            src={extractedPattern.confidenceMap}
                            alt="Confidence"
                            className="w-full h-auto"
                          />
                        ) : (
                          <div className="h-20 flex items-center justify-center text-gray-500 text-xs">
                            No image
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4
                        className="text-xs font-medium text-gray-300 mb-1 cursor-help"
                        title="Binary mask showing which pixels are included in the pattern. White pixels are included (confidence above threshold), black pixels are excluded (confidence below threshold or too variable)."
                      >
                        Mask
                      </h4>
                      <div className="border rounded bg-gray-50 p-2">
                        {extractedPattern.maskImage ? (
                          <img
                            src={extractedPattern.maskImage}
                            alt="Mask"
                            className="w-full h-auto"
                          />
                        ) : (
                          <div className="h-20 flex items-center justify-center text-gray-500 text-xs">
                            No image
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Color Legend */}
                  <div className="text-xs text-gray-500 space-y-1 bg-gray-50 rounded p-2">
                    <div className="font-medium mb-1">Color Guide:</div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-white border border-gray-300 rounded"></div>
                      <span>High confidence / Included pixels</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-black rounded"></div>
                      <span>Low confidence / Excluded pixels</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-gray-500 rounded"></div>
                      <span>Medium confidence (Confidence Map only)</span>
                    </div>
                  </div>

                  {/* Statistics */}
                  <div className="bg-[#27272A] rounded-lg p-3 border border-gray-700">
                    <h4 className="text-xs font-medium text-gray-300 mb-2">
                      Statistics
                    </h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Mask Density:</span>
                        <span className="font-mono text-gray-900">
                          {(extractedPattern.maskDensity * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Active Pixels:</span>
                        <span className="font-mono text-gray-900">
                          {extractedPattern.activePixels.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Min Confidence:</span>
                        <span className="font-mono text-gray-900">
                          {(extractedPattern.minConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Avg Confidence:</span>
                        <span className="font-mono text-gray-900">
                          {(extractedPattern.avgConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recommendations */}
                {(patternQuality?.recommendations?.length ?? 0) > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <h4 className="text-sm font-medium text-white mb-1">
                      Recommendations
                    </h4>
                    <ul className="text-xs text-amber-800 space-y-1">
                      {patternQuality?.recommendations?.map((rec, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-amber-600">•</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="mb-3">
                  <div className="w-16 h-16 mx-auto bg-[#27272A] rounded-full flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-gray-500" />
                  </div>
                </div>
                <p className="font-medium text-white">No Pattern Extracted</p>
                <p className="text-sm text-gray-500 mt-1">
                  Configure settings and extract a pattern
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* StateImage Creation Dialog */}
      {showStateImageDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#27272A] border border-gray-700 rounded-lg p-6 w-96 max-w-full">
            <h3 className="text-lg font-semibold text-white mb-4">
              Create StateImage
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  StateImage Name
                </label>
                <input
                  type="text"
                  value={stateImageName}
                  onChange={(e) => setStateImageName(e.target.value)}
                  placeholder="Enter name for the StateImage"
                  className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
                />
              </div>

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

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="fixed-location-pattern"
                  checked={fixedLocation}
                  onChange={(e) => setFixedLocation(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label
                  htmlFor="fixed-location-pattern"
                  className="ml-2 block text-sm text-gray-700"
                >
                  Fixed location pattern (saves pattern region as search region)
                </label>
              </div>

              {editedPattern && (
                <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                  Using edited pattern with transparency modifications
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowStateImageDialog(false);
                  setStateImageName("");
                  setSelectedStateId("");
                  setNewStateName("");
                }}
                className="px-4 py-2 text-sm text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateStateImage}
                disabled={
                  !stateImageName ||
                  !selectedStateId ||
                  (selectedStateId === "new" && !newStateName.trim())
                }
                className="px-4 py-2 text-sm text-black bg-[#00FF88] rounded-md hover:bg-[#00FF88]/90 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                Create StateImage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Selector with multi-select */}
      <ScreenshotSelector
        selectedScreenshot=""
        onSelectScreenshot={() => {}}
        multiSelect={true}
        selectedScreenshots={[]}
        onSelectScreenshots={handleProjectScreenshotSelect}
        allowUpload={false}
        trigger={
          <button
            ref={screenshotSelectorTriggerRef}
            style={{ display: "none" }}
          />
        }
      />
    </div>
  );
};

/**
 * Pattern Optimization Component with Provider
 * Wraps the content with the PatternOptimizationProvider
 */
export const PatternOptimizationSimplified: React.FC = () => {
  return (
    <PatternOptimizationProvider>
      <PatternOptimizationContent />
    </PatternOptimizationProvider>
  );
};
