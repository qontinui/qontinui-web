import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  Upload,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sliders,
  Play,
  RefreshCw,
  Download,
  X,
  CheckCircle,
  AlertCircle,
  Camera,
  Target,
  Layers,
} from "lucide-react";
import { Screenshot } from "../../contexts/automation-context/types";
import { useAutomation } from "../../contexts/automation-context";
import { usePatternTestsBridge, type MatchResult } from "@/stores/page-state";
import { qontinuiAPI } from "../../lib/qontinui-api-client";
import { ScreenshotPicker } from "../common/ScreenshotPicker";
import { ScreenshotRegion } from "../../types/Screenshot";

interface PatternMatchingTestProps {
  screenshots: Screenshot[];
}

export const PatternMatchingTest: React.FC<PatternMatchingTestProps> = ({
  screenshots,
}) => {
  const {
    states,
    images,
    screenshots: contextScreenshots,
    resolvePatternImage,
  } = useAutomation();

  // Use bridge hook for persistent state
  const bridge = usePatternTestsBridge();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const templateCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use context screenshots if available, otherwise fall back to prop screenshots
  const activeScreenshots =
    contextScreenshots.length > 0 ? contextScreenshots : screenshots;

  // Local state (not persisted)
  const [currentDisplayScale, setCurrentDisplayScale] = useState<number>(1);
  const [isSearching, setIsSearching] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Extract persisted state from bridge
  const {
    isHydrating,
    selectedScreenshot,
    screenshotDimensions,
    templateImage,
    templateSource,
    selectedStateImage,
    selectedAssetImage,
    similarity,
    findAll,
    searchRegion,
    matches,
    searchTime,
    selectedMatch,
    showMatches,
    showScores,
    showHeatmap,
    highlightBest,
    zoom,
    panOffset,
    handleUploadScreenshot,
    handleSelectProjectScreenshot,
    handleClearScreenshot,
    setScreenshotDimensions,
    setTemplateImage,
    setTemplateSource,
    setSelectedStateImage,
    setSelectedAssetImage,
    setSimilarity,
    setFindAll,
    setSearchRegion,
    setMatches,
    setSearchTime,
    setSelectedMatch,
    setShowMatches,
    setShowScores,
    setShowHeatmap,
    setHighlightBest,
    setZoom,
    setPanOffset,
    resetView,
  } = bridge;

  // API connection
  const [apiConnected, setApiConnected] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    checkAPIConnection();
  }, []);

  useEffect(() => {
    drawVisualization();
  }, [
    selectedScreenshot,
    matches,
    selectedMatch,
    showMatches,
    showScores,
    showHeatmap,
    highlightBest,
    zoom,
    panOffset,
  ]);

  useEffect(() => {
    drawTemplate();
  }, [templateImage]);

  const checkAPIConnection = async () => {
    try {
      const connected = await qontinuiAPI.testConnection();
      setApiConnected(connected);
      if (connected) {
        setApiError(null);
      } else {
        setApiError("API health check returned unhealthy status");
      }
    } catch (error) {
      setApiConnected(false);
      setApiError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleUploadScreenshotWrapper = (file: File) => {
    handleUploadScreenshot(file);
  };

  const handleSelectProjectScreenshotWrapper = async (screenshotId: string) => {
    const projectScreenshot = activeScreenshots.find(
      (s) => s.id === screenshotId
    );
    if (projectScreenshot) {
      await handleSelectProjectScreenshot({
        id: projectScreenshot.id,
        name: projectScreenshot.name,
        url: projectScreenshot.url,
      });
    }
  };

  const handleClearScreenshotWrapper = () => {
    handleClearScreenshot();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setTemplateImage(dataUrl);
        setTemplateSource("upload");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStateImageSelect = (imageData: string) => {
    setTemplateImage(imageData);
    setTemplateSource("state");
  };

  const handleAssetImageSelect = (imageUrl: string) => {
    setTemplateImage(imageUrl);
    setTemplateSource("asset");
  };

  const drawVisualization = useCallback(() => {
    if (!selectedScreenshot || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw screenshot
    const img = new Image();
    img.onload = () => {
      // Update dimensions when image loads
      if (
        !screenshotDimensions ||
        screenshotDimensions.width !== img.width ||
        screenshotDimensions.height !== img.height
      ) {
        setScreenshotDimensions({ width: img.width, height: img.height });
      }

      // Calculate max dimensions to fit in viewport (leaving room for panels)
      const maxWidth = window.innerWidth - 400 - 100; // Subtract left panel width + padding
      const maxHeight = window.innerHeight - 200; // Subtract header and controls

      // Calculate base scale to fit within viewport while maintaining aspect ratio
      const scaleToFit = Math.min(
        maxWidth / img.width,
        maxHeight / img.height,
        1
      );
      // Apply zoom factor on top of fit-to-screen scale
      const displayScale = scaleToFit * zoom;

      // Store current display scale for click handling
      setCurrentDisplayScale(displayScale);

      // Calculate canvas size - always fit to viewport
      const canvasWidth = Math.min(img.width * displayScale, maxWidth);
      const canvasHeight = Math.min(img.height * displayScale, maxHeight);

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply pan offset when drawing
      ctx.save();
      ctx.translate(panOffset.x, panOffset.y);

      // Draw image with zoom applied
      ctx.drawImage(
        img,
        0,
        0,
        img.width * displayScale,
        img.height * displayScale
      );

      ctx.restore();

      // Draw search region if defined (with pan offset)
      if (searchRegion) {
        ctx.save();
        ctx.translate(panOffset.x, panOffset.y);
        ctx.strokeStyle = "#0066ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          searchRegion.x * displayScale,
          searchRegion.y * displayScale,
          searchRegion.width * displayScale,
          searchRegion.height * displayScale
        );
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (!showMatches) return;

      // Draw heatmap if enabled (with pan offset)
      if (showHeatmap && matches.length > 0) {
        ctx.save();
        ctx.translate(panOffset.x, panOffset.y);
        ctx.globalAlpha = 0.3;
        matches.forEach((match) => {
          const intensity = match.score;
          const red = Math.floor((1 - intensity) * 255);
          const green = Math.floor(intensity * 255);
          ctx.fillStyle = `rgb(${red}, ${green}, 0)`;
          ctx.fillRect(
            match.region.x * displayScale,
            match.region.y * displayScale,
            match.region.width * displayScale,
            match.region.height * displayScale
          );
        });
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // Sort matches by score for proper layering
      const sortedMatches = [...matches].sort((a, b) => a.score - b.score);

      // Draw matches (with pan offset)
      ctx.save();
      ctx.translate(panOffset.x, panOffset.y);

      sortedMatches.forEach((match, index) => {
        const isBest = highlightBest && index === sortedMatches.length - 1;
        const isSelected = selectedMatch === match;

        // Calculate color based on score
        let color = "#00ff00";
        if (match.score >= 0.95) {
          color = "#00ff00"; // Green - excellent
        } else if (match.score >= 0.9) {
          color = "#88ff00"; // Light green - very good
        } else if (match.score >= 0.8) {
          color = "#ffff00"; // Yellow - good
        } else if (match.score >= 0.7) {
          color = "#ff8800"; // Orange - acceptable
        } else {
          color = "#ff0000"; // Red - poor
        }

        if (isBest) color = "#00ffff"; // Cyan for best
        if (isSelected) color = "#ff00ff"; // Magenta for selected

        const x = match.region.x * displayScale;
        const y = match.region.y * displayScale;
        const width = match.region.width * displayScale;
        const height = match.region.height * displayScale;

        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected || isBest ? 3 : 2;
        ctx.strokeRect(x, y, width, height);

        // Draw semi-transparent fill
        ctx.fillStyle = color + "20";
        ctx.fillRect(x, y, width, height);

        // Draw center crosshair
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX - 10, centerY);
        ctx.lineTo(centerX + 10, centerY);
        ctx.moveTo(centerX, centerY - 10);
        ctx.lineTo(centerX, centerY + 10);
        ctx.stroke();

        // Draw score label
        if (showScores) {
          const scoreText = `${(match.score * 100).toFixed(1)}%`;
          ctx.font = `${12 * displayScale}px sans-serif`;
          const textMetrics = ctx.measureText(scoreText);
          const padding = 3 * displayScale;

          // Score background
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(
            x,
            y - 20 * displayScale,
            textMetrics.width + padding * 2,
            16 * displayScale
          );

          // Score text
          ctx.fillStyle = color;
          ctx.fillText(scoreText, x + padding, y - 7 * displayScale);
        }

        // Draw match number
        if (matches.length > 1) {
          ctx.font = `${10 * displayScale}px sans-serif`;
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          const numText = `#${match.index || index + 1}`;
          ctx.fillRect(
            x + width - 25 * displayScale,
            y + height - 18 * displayScale,
            23 * displayScale,
            16 * displayScale
          );
          ctx.fillStyle = "#ffffff";
          ctx.fillText(
            numText,
            x + width - 22 * displayScale,
            y + height - 6 * displayScale
          );
        }
      });

      ctx.restore(); // Restore context after drawing matches
    };
    img.src = selectedScreenshot.url;
  }, [
    selectedScreenshot,
    matches,
    selectedMatch,
    showMatches,
    showScores,
    showHeatmap,
    highlightBest,
    searchRegion,
    zoom,
    panOffset,
  ]);

  const drawTemplate = useCallback(() => {
    if (!templateImage || !templateCanvasRef.current) return;

    const canvas = templateCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas size to fit container
      const maxWidth = 200;
      const maxHeight = 150;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);

      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = templateImage;
  }, [templateImage]);

  const performPatternMatching = async () => {
    if (!selectedScreenshot || !templateImage || !apiConnected) return;

    console.log("[PatternMatching] Starting pattern matching...");
    console.log(
      "[PatternMatching] Screenshot URL length:",
      selectedScreenshot.url.length
    );
    console.log(
      "[PatternMatching] Screenshot URL prefix:",
      selectedScreenshot.url.substring(0, 50)
    );
    console.log("[PatternMatching] Template URL length:", templateImage.length);
    console.log(
      "[PatternMatching] Template URL prefix:",
      templateImage.substring(0, 50)
    );
    console.log("[PatternMatching] Similarity threshold:", similarity);
    console.log("[PatternMatching] Find all:", findAll);
    console.log("[PatternMatching] Search region:", searchRegion);

    setIsSearching(true);
    setMatches([]);
    const startTime = Date.now();

    try {
      let result;
      if (findAll) {
        console.log("[PatternMatching] Calling findAll...");
        result = await qontinuiAPI.findAll(
          selectedScreenshot.url,
          templateImage,
          similarity,
          searchRegion
            ? ({
                bounds: searchRegion,
                id: "search-region",
                name: "Search Region",
                screenshotId: selectedScreenshot.id,
                stateId: "",
                type: "SearchRegion" as const,
              } as ScreenshotRegion)
            : undefined
        );

        console.log("[PatternMatching] findAll result:", result);

        if (result.found && result.matches) {
          const matchResults: MatchResult[] = result.matches
            .filter((m) => m.region !== undefined)
            .map((m, idx) => ({
              region: m.region!,
              score: m.score,
              index: idx + 1,
            }));
          console.log("[PatternMatching] Found matches:", matchResults.length);
          setMatches(matchResults);
        } else {
          console.log("[PatternMatching] No matches found");
        }
      } else {
        console.log("[PatternMatching] Calling find...");
        result = await qontinuiAPI.find(
          selectedScreenshot.url,
          templateImage,
          similarity,
          searchRegion
            ? ({
                bounds: searchRegion,
                id: "search-region",
                name: "Search Region",
                screenshotId: selectedScreenshot.id,
                stateId: "",
                type: "SearchRegion" as const,
              } as ScreenshotRegion)
            : undefined
        );

        console.log("[PatternMatching] find result:", result);

        if (result.found && result.region) {
          console.log(
            "[PatternMatching] Found match with score:",
            result.score
          );
          setMatches([
            {
              region: result.region,
              score: result.score,
              index: 1,
            },
          ]);
        } else {
          console.log("[PatternMatching] No match found");
        }
      }

      setSearchTime(Date.now() - startTime);
    } catch (error) {
      console.error("Pattern matching failed:", error);
      setMatches([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / currentDisplayScale;
    const y = (e.clientY - rect.top) / currentDisplayScale;

    // Check if clicking on a match
    const clickedMatch = matches.find(
      (m) =>
        x >= m.region.x &&
        x <= m.region.x + m.region.width &&
        y >= m.region.y &&
        y <= m.region.y + m.region.height
    );

    if (clickedMatch) {
      setSelectedMatch(clickedMatch);
    } else {
      setSelectedMatch(null);
    }
  };

  const exportResults = () => {
    const results = {
      screenshot: selectedScreenshot?.name,
      template: templateSource,
      similarity,
      searchRegion,
      searchTime,
      matches: matches.map((m) => ({
        region: m.region,
        score: m.score,
      })),
      statistics: {
        totalMatches: matches.length,
        bestScore:
          matches.length > 0 ? Math.max(...matches.map((m) => m.score)) : 0,
        avgScore:
          matches.length > 0
            ? matches.reduce((sum, m) => sum + m.score, 0) / matches.length
            : 0,
      },
    };

    const blob = new Blob([JSON.stringify(results, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pattern-matching-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleZoomIn = () => {
    const newZoom = Math.min(zoom * 1.2, 10); // Allow up to 10x zoom
    setZoom(newZoom);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom / 1.2, 0.1);
    setZoom(newZoom);
    // Reset pan if zooming out to fit
    if (newZoom <= 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  };

  const handleFitToScreen = () => {
    resetView();
  };

  // Mouse wheel zoom with native event listener to support preventDefault
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY / 1000;
      const newZoom = Math.max(0.1, Math.min(10, zoom * (1 + delta)));
      setZoom(newZoom);

      // Reset pan if zooming out to fit
      if (newZoom <= 1) {
        setPanOffset({ x: 0, y: 0 });
      }
    },
    [zoom]
  );

  // Attach native wheel event listener to support preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel]);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (zoom > 1) {
        // Only allow panning when zoomed in
        setIsPanning(true);
        setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      }
    },
    [zoom, panOffset]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isPanning) {
        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isPanning, panStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const clearSearchRegion = () => {
    setSearchRegion(null);
  };

  // Show loading state while hydrating
  if (isHydrating) {
    return (
      <div className="h-full flex flex-col bg-[#0A0A0B] items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 text-blue-600 animate-spin" />
          <p className="text-gray-400">Loading pattern tests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0A0A0B]">
      {/* Header */}
      <div className="bg-[#27272A] border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Search className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold">Pattern Matching Test</h2>
              <p className="text-sm text-gray-400">
                Test image pattern matching on screenshots with real Qontinui
                engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                apiConnected
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {apiConnected ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              {apiConnected ? "API Connected" : "API Disconnected"}
            </div>
            {!apiConnected && (
              <button
                onClick={checkAPIConnection}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                title="Retry connection"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            {apiError && (
              <div
                className="px-3 py-1 bg-red-900/20 border border-red-700 rounded text-xs text-red-200 max-w-md truncate"
                title={apiError}
              >
                {apiError}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-96 bg-[#27272A]/50 border-r overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Screenshot Selection */}
            <div className="bg-[#27272A]/50 rounded-lg border border-gray-800">
              <ScreenshotPicker
                currentScreenshot={
                  selectedScreenshot
                    ? {
                        id: selectedScreenshot.id,
                        name: selectedScreenshot.name,
                        url: selectedScreenshot.url,
                      }
                    : null
                }
                onUploadScreenshot={handleUploadScreenshotWrapper}
                onSelectProjectScreenshot={handleSelectProjectScreenshotWrapper}
                onClearScreenshot={handleClearScreenshotWrapper}
              />
            </div>

            {/* Template Image Selection */}
            <div className="bg-[#0A0A0B] p-3 rounded-lg border border-gray-800 border-gray-700">
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                <ImageIcon className="w-4 h-4 inline mr-1" />
                Pattern Image
              </label>

              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setTemplateSource("upload")}
                  className={`flex-1 px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                    templateSource === "upload"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-[#27272A]/50 text-gray-300 border border-gray-800 border-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Upload
                </button>
                <button
                  onClick={() => setTemplateSource("state")}
                  className={`flex-1 px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                    templateSource === "state"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-[#27272A]/50 text-gray-300 border border-gray-800 border-gray-700 hover:bg-gray-50"
                  }`}
                >
                  State Image
                </button>
                <button
                  onClick={() => setTemplateSource("asset")}
                  className={`flex-1 px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                    templateSource === "asset"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-[#27272A]/50 text-gray-300 border border-gray-800 border-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Asset
                </button>
              </div>

              {templateSource === "upload" && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Image
                  </button>
                </div>
              )}

              {templateSource === "state" && (
                <div className="space-y-2">
                  <select
                    value={selectedStateImage}
                    onChange={(e) => {
                      setSelectedStateImage(e.target.value);
                      if (e.target.value) {
                        // Find the state image data
                        states.forEach((state) => {
                          state.stateImages?.forEach((img) => {
                            if (
                              img.id === e.target.value &&
                              img.patterns?.[0]
                            ) {
                              const imageData = resolvePatternImage(
                                img.patterns[0]
                              );
                              if (imageData) {
                                handleStateImageSelect(imageData.url);
                              }
                            }
                          });
                        });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-800 border-gray-400 rounded-lg text-sm text-white bg-[#27272A]/50 font-medium focus:outline-none focus:ring-2 focus:ring-[#00D9FF] focus:border-blue-500"
                  >
                    <option value="" className="text-gray-400 font-normal">
                      Select state image
                    </option>
                    {states.map((state) => (
                      <optgroup
                        key={state.id}
                        label={state.name}
                        className="text-white font-bold"
                      >
                        {state.stateImages?.map((img) => (
                          <option
                            key={img.id}
                            value={img.id}
                            className="text-gray-800 font-medium"
                          >
                            {img.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  {/* Visual preview of state images */}
                  {states.some(
                    (s) => s.stateImages && s.stateImages.length > 0
                  ) && (
                    <div className="max-h-48 overflow-y-auto bg-[#27272A]/50 p-2 rounded-lg border border-gray-800 border-gray-700">
                      <div className="grid grid-cols-4 gap-2">
                        {states.flatMap((state) =>
                          (state.stateImages || []).map((img) => (
                            <button
                              key={img.id}
                              onClick={() => {
                                setSelectedStateImage(img.id);
                                if (img.patterns?.[0]) {
                                  const imageData = resolvePatternImage(
                                    img.patterns[0]
                                  );
                                  if (imageData) {
                                    handleStateImageSelect(imageData.url);
                                  }
                                }
                              }}
                              className={`p-1 border-2 rounded transition-all ${
                                selectedStateImage === img.id
                                  ? "border-blue-500 bg-blue-100 shadow-lg ring-2 ring-blue-300"
                                  : "border-gray-700 bg-[#0A0A0B] hover:border-gray-500 hover:bg-white"
                              }`}
                              title={`${state.name} - ${img.name}`}
                            >
                              {(() => {
                                const imageData = img.patterns?.[0]
                                  ? resolvePatternImage(img.patterns[0])
                                  : null;
                                return imageData ? (
                                  <img
                                    src={imageData.url}
                                    alt={img.name}
                                    className="w-full h-12 object-contain"
                                  />
                                ) : (
                                  <div className="w-full h-12 bg-gray-700 flex items-center justify-center border border-gray-800 border-gray-700 rounded">
                                    <span className="text-xs text-gray-400 font-medium">
                                      No image
                                    </span>
                                  </div>
                                );
                              })()}
                              <span className="text-xs text-white font-semibold block mt-1 truncate px-1 bg-[#27272A]/50 bg-opacity-90 rounded">
                                {img.name}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {!states.some(
                    (s) => s.stateImages && s.stateImages.length > 0
                  ) && (
                    <div className="text-sm text-gray-300 bg-yellow-50 border border-gray-800 border-yellow-200 p-3 rounded-lg text-center font-medium">
                      No state images available. Define them in the State
                      Structure tab.
                    </div>
                  )}
                </div>
              )}

              {templateSource === "asset" && (
                <select
                  value={selectedAssetImage}
                  onChange={(e) => {
                    setSelectedAssetImage(e.target.value);
                    const asset = images.find(
                      (img) => img.id === e.target.value
                    );
                    if (asset) {
                      handleAssetImageSelect(asset.url);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-800 border-gray-400 rounded-lg text-sm text-white bg-[#27272A]/50 font-medium"
                >
                  <option value="">Select asset image</option>
                  {images.map((img) => (
                    <option key={img.id} value={img.id}>
                      {img.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Template Preview */}
              {templateImage && (
                <div className="mt-3 p-3 bg-[#27272A] rounded-lg border border-gray-800 border-gray-700">
                  <div className="text-xs font-bold text-gray-800 mb-2 uppercase tracking-wide">
                    Template Preview
                  </div>
                  <div className="flex justify-center">
                    <canvas
                      ref={templateCanvasRef}
                      className="border border-gray-800 border-gray-700"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Matching Parameters */}
            <div className="bg-[#0A0A0B] p-3 rounded-lg border border-gray-800 border-gray-700">
              <label className="block text-sm font-semibold text-gray-800 mb-3">
                <Sliders className="w-4 h-4 inline mr-1" />
                Matching Parameters
              </label>

              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-300 font-medium">
                    Similarity Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.5"
                      max="1"
                      step="0.01"
                      value={similarity}
                      onChange={(e) =>
                        setSimilarity(parseFloat(e.target.value))
                      }
                      className="flex-1"
                    />
                    <span className="text-sm font-mono font-bold text-white w-12 bg-[#27272A]/50 px-1 py-0.5 rounded border border-gray-800 border-gray-700">
                      {(similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={findAll}
                    onChange={(e) => setFindAll(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-800 font-medium">
                    Find all matches
                  </span>
                </label>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm text-gray-300 font-medium">
                      Search Region
                    </label>
                    {searchRegion && (
                      <button
                        onClick={clearSearchRegion}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {searchRegion ? (
                    <div className="text-xs bg-[#27272A]/50 p-2 rounded border border-gray-800 border-gray-700 font-mono font-semibold text-white">
                      ({searchRegion.x}, {searchRegion.y}) -{" "}
                      {searchRegion.width}×{searchRegion.height}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 bg-[#27272A]/50 p-2 rounded border border-gray-800 border-gray-700 italic">
                      Full screenshot (click and drag to define region)
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 border-t">
              <button
                onClick={performPatternMatching}
                disabled={
                  !selectedScreenshot ||
                  !templateImage ||
                  !apiConnected ||
                  isSearching
                }
                className={`w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2 font-medium ${
                  !selectedScreenshot ||
                  !templateImage ||
                  !apiConnected ||
                  isSearching
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {isSearching ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run Pattern Matching
                  </>
                )}
              </button>

              {/* Show why button is disabled */}
              {(!selectedScreenshot || !templateImage || !apiConnected) &&
                !isSearching && (
                  <div className="mt-2 p-2 bg-yellow-900/20 border border-yellow-700 rounded text-xs text-yellow-200">
                    <div className="font-semibold mb-1">Requirements:</div>
                    <div
                      className={
                        selectedScreenshot
                          ? "text-green-400"
                          : "text-yellow-200"
                      }
                    >
                      {selectedScreenshot ? "✓" : "○"} Select a screenshot
                    </div>
                    <div
                      className={
                        templateImage ? "text-green-400" : "text-yellow-200"
                      }
                    >
                      {templateImage ? "✓" : "○"} Select a pattern image
                    </div>
                    <div
                      className={
                        apiConnected ? "text-green-400" : "text-red-400"
                      }
                    >
                      {apiConnected ? "✓" : "✗"} API connection{" "}
                      {!apiConnected && "(Start the backend)"}
                    </div>
                  </div>
                )}

              {matches.length > 0 && (
                <button
                  onClick={exportResults}
                  className="w-full mt-2 px-4 py-2 bg-[#27272A] text-gray-300 rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Results
                </button>
              )}
            </div>

            {/* Debug Panel */}
            {templateImage && selectedScreenshot && (
              <div className="pt-4 border-t">
                <h3 className="font-bold text-white mb-3 text-sm">
                  Debug Info
                </h3>
                <div className="space-y-3">
                  {/* Template Preview */}
                  <div className="bg-[#0A0A0B] p-2 rounded border border-gray-700">
                    <div className="text-xs text-gray-400 mb-1">
                      Template Image:
                    </div>
                    <img
                      src={templateImage}
                      alt="Template"
                      className="max-w-full h-auto border border-[#00D9FF] rounded"
                      style={{
                        maxHeight: "100px",
                        imageRendering: "pixelated",
                      }}
                      onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        console.log(
                          "[PatternMatching] Template dimensions:",
                          img.naturalWidth,
                          "x",
                          img.naturalHeight
                        );
                        if (img.naturalWidth < 20 || img.naturalHeight < 20) {
                          console.warn(
                            "[PatternMatching] Template is very small! This may cause unreliable matching."
                          );
                        }
                      }}
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      Size: {(templateImage.length / 1024).toFixed(1)}KB
                    </div>
                    {templateImage.length < 2000 && (
                      <div className="text-xs text-amber-400 mt-1 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>
                          Very small template - may cause false matches
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Quick Test Buttons */}
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400 mb-1">
                      Quick Tests:
                    </div>
                    <button
                      onClick={() => setSimilarity(0.5)}
                      className="w-full px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
                    >
                      Try 50% Similarity
                    </button>
                    <button
                      onClick={() => setSimilarity(0.3)}
                      className="w-full px-2 py-1 bg-orange-600 text-white text-xs rounded hover:bg-orange-700"
                    >
                      Try 30% Similarity (Very Loose)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Results Summary */}
            {matches.length > 0 && (
              <div className="pt-4 border-t">
                <h3 className="font-bold text-white mb-3">Results Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Matches Found:</span>
                    <span className="font-medium text-white">
                      {matches.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Best Score:</span>
                    <span className="font-medium text-green-400">
                      {Math.max(...matches.map((m) => m.score * 100)).toFixed(
                        1
                      )}
                      %
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Avg Score:</span>
                    <span className="font-medium text-white">
                      {(
                        (matches.reduce((sum, m) => sum + m.score, 0) /
                          matches.length) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Search Time:</span>
                    <span className="font-medium text-white">
                      {searchTime}ms
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Panel - Visualization */}
        <div className="flex-1 flex flex-col">
          {/* Visualization Controls */}
          <div className="bg-[#27272A] border-b border-gray-800 px-4 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleZoomOut}
                    className="p-1.5 hover:bg-blue-50 rounded border border-gray-800 border-gray-700 bg-[#27272A]/50 text-gray-300 hover:text-blue-600 transition-colors"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleFitToScreen}
                    className="p-1.5 hover:bg-blue-50 rounded border border-gray-800 border-gray-700 bg-[#27272A]/50 text-gray-300 hover:text-blue-600 transition-colors"
                    title="Fit to Screen"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleZoomIn}
                    className="p-1.5 hover:bg-blue-50 rounded border border-gray-800 border-gray-700 bg-[#27272A]/50 text-gray-300 hover:text-blue-600 transition-colors"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-mono font-bold text-white px-2 py-0.5 bg-[#27272A] rounded border border-gray-800 border-gray-700">
                    {Math.round(zoom * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-3 border-l pl-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showMatches}
                      onChange={(e) => setShowMatches(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-sm font-semibold text-gray-800">
                      Matches
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showScores}
                      onChange={(e) => setShowScores(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-sm font-semibold text-gray-800">
                      Scores
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHeatmap}
                      onChange={(e) => setShowHeatmap(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-sm font-semibold text-gray-800">
                      Heatmap
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={highlightBest}
                      onChange={(e) => setHighlightBest(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-sm font-semibold text-gray-800">
                      Best Match
                    </span>
                  </label>
                </div>
              </div>

              {matches.length > 0 && (
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-bold text-white">
                    {matches.length} matches
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto bg-[#27272A]">
            {selectedScreenshot ? (
              <div className="relative max-w-full max-h-full">
                <canvas
                  ref={canvasRef}
                  className="border border-gray-800 border-gray-700 shadow-lg max-w-full max-h-full"
                  style={{
                    cursor: isPanning
                      ? "grabbing"
                      : zoom > 1
                        ? "grab"
                        : "crosshair",
                  }}
                  onClick={handleCanvasClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />

                {/* Selected Match Info Overlay */}
                {selectedMatch && (
                  <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white p-3 rounded-lg text-sm max-w-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">Match Details</span>
                      <button
                        onClick={() => setSelectedMatch(null)}
                        className="text-gray-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div>
                        Score:{" "}
                        <strong>
                          {(selectedMatch.score * 100).toFixed(2)}%
                        </strong>
                      </div>
                      <div>
                        Position: ({selectedMatch.region.x},{" "}
                        {selectedMatch.region.y})
                      </div>
                      <div>
                        Size: {selectedMatch.region.width} ×{" "}
                        {selectedMatch.region.height}
                      </div>
                      <div>
                        Center: (
                        {Math.round(
                          selectedMatch.region.x +
                            selectedMatch.region.width / 2
                        )}
                        ,{" "}
                        {Math.round(
                          selectedMatch.region.y +
                            selectedMatch.region.height / 2
                        )}
                        )
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Select a screenshot to begin</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Match Results */}
        <div className="w-80 bg-[#27272A]/50 border-l overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Matches</h3>
              </div>
              {matches.length > 0 && (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  {matches.length}
                </span>
              )}
            </div>

            {matches.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No matches found</p>
                <p className="text-xs mt-1">
                  Adjust similarity or search region
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {matches.map((match, index) => {
                  const isBest =
                    match.score === Math.max(...matches.map((m) => m.score));
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedMatch(match)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        selectedMatch === match
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-700 hover:border-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {/* Match Header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">
                            Match #{match.index || index + 1}
                          </span>
                          {isBest && (
                            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                              Best
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-lg font-bold ${
                            match.score >= 0.9
                              ? "text-green-600"
                              : match.score >= 0.8
                                ? "text-yellow-600"
                                : "text-red-600"
                          }`}
                        >
                          {(match.score * 100).toFixed(1)}%
                        </div>
                      </div>

                      {/* Match Image - will render when image loads */}
                      <div className="mb-2 bg-[#27272A] rounded overflow-hidden">
                        <MatchThumbnail
                          screenshot={selectedScreenshot}
                          match={match}
                        />
                      </div>

                      {/* Match Details */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                        <div>
                          <div className="font-medium text-gray-500">
                            Position
                          </div>
                          <div className="font-mono">
                            ({match.region.x}, {match.region.y})
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-gray-500">Size</div>
                          <div className="font-mono">
                            {match.region.width} × {match.region.height}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <div className="font-medium text-gray-500">
                            Center
                          </div>
                          <div className="font-mono">
                            (
                            {Math.round(
                              match.region.x + match.region.width / 2
                            )}
                            ,{" "}
                            {Math.round(
                              match.region.y + match.region.height / 2
                            )}
                            )
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper component to render match thumbnail
const MatchThumbnail: React.FC<{
  screenshot: { id: string; name: string; url: string } | null;
  match: MatchResult;
}> = ({ screenshot, match }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!screenshot || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Set canvas size to match region
      canvas.width = match.region.width;
      canvas.height = match.region.height;

      // Draw the cropped region
      ctx.drawImage(
        img,
        match.region.x,
        match.region.y,
        match.region.width,
        match.region.height,
        0,
        0,
        match.region.width,
        match.region.height
      );
    };
    img.src = screenshot.url;
  }, [screenshot, match]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-auto"
      style={{ imageRendering: "pixelated" }}
    />
  );
};

export default PatternMatchingTest;
