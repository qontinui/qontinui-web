import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Target,
  Sliders,
  Download,
  Play,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Screenshot } from "../../types/Screenshot";
import { StateImage } from "../../contexts/automation-context";
import { qontinuiAPI, testStateImage } from "../../lib/qontinui-api-client";

interface FindMatch {
  region: { x: number; y: number; width: number; height: number };
  score: number;
  color?: string;
  label?: string;
}

interface FindOperationVisualizerProps {
  screenshot: Screenshot;
  stateImage?: StateImage;
  onMatchesFound?: (matches: FindMatch[]) => void;
}

export const FindOperationVisualizer: React.FC<
  FindOperationVisualizerProps
> = ({ screenshot, stateImage, onMatchesFound }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [similarity, setSimilarity] = useState(0.8);
  const [isSearching, setIsSearching] = useState(false);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<FindMatch | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [highlightBest, setHighlightBest] = useState(true);
  const [showScores, setShowScores] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  // Statistics
  const [searchTime, setSearchTime] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [avgScore, setAvgScore] = useState(0);

  useEffect(() => {
    checkAPIConnection();
  }, []);

  useEffect(() => {
    drawVisualization();
  }, [screenshot, matches, scale, selectedMatch, showRegions, highlightBest]);

  const checkAPIConnection = async () => {
    const connected = await qontinuiAPI.testConnection();
    setApiConnected(connected);
  };

  const drawVisualization = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = screenshot.width * scale;
    canvas.height = screenshot.height * scale;

    // Draw screenshot
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (!showRegions) return;

      // Sort matches by score to draw best ones on top
      const sortedMatches = [...matches].sort((a, b) => a.score - b.score);

      // Draw each match
      sortedMatches.forEach((match, index) => {
        const isBest = highlightBest && index === sortedMatches.length - 1;
        const isSelected = selectedMatch === match;

        // Calculate scaled positions
        const x = match.region.x * scale;
        const y = match.region.y * scale;
        const width = match.region.width * scale;
        const height = match.region.height * scale;

        // Determine color based on score
        let color = "#00ff00"; // Default green
        if (match.score >= 0.9) {
          color = "#00ff00"; // Green for excellent match
        } else if (match.score >= 0.8) {
          color = "#ffff00"; // Yellow for good match
        } else if (match.score >= 0.7) {
          color = "#ff8800"; // Orange for acceptable match
        } else {
          color = "#ff0000"; // Red for poor match
        }

        if (isBest) color = "#00ffff"; // Cyan for best match
        if (isSelected) color = "#ff00ff"; // Magenta for selected

        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected || isBest ? 3 : 2;
        ctx.strokeRect(x, y, width, height);

        // Draw semi-transparent fill
        ctx.fillStyle = color + "30"; // Add alpha
        ctx.fillRect(x, y, width, height);

        // Draw score if enabled
        if (showScores) {
          const scoreText = `${(match.score * 100).toFixed(1)}%`;
          ctx.font = `${14 * scale}px sans-serif`;
          const textMetrics = ctx.measureText(scoreText);
          const padding = 4 * scale;

          // Draw score background
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(
            x,
            y - 24 * scale,
            textMetrics.width + padding * 2,
            20 * scale
          );

          // Draw score text
          ctx.fillStyle = color;
          ctx.fillText(scoreText, x + padding, y - 8 * scale);
        }

        // Draw match number
        if (matches.length > 1) {
          const matchNum = `#${index + 1}`;
          ctx.font = `${12 * scale}px sans-serif`;
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(
            x + width - 30 * scale,
            y + height - 20 * scale,
            28 * scale,
            18 * scale
          );
          ctx.fillStyle = "#ffffff";
          ctx.fillText(
            matchNum,
            x + width - 26 * scale,
            y + height - 6 * scale
          );
        }
      });

      // Draw crosshair for selected match
      if (selectedMatch && showRegions) {
        const centerX =
          (selectedMatch.region.x + selectedMatch.region.width / 2) * scale;
        const centerY =
          (selectedMatch.region.y + selectedMatch.region.height / 2) * scale;
        const crosshairSize = 20 * scale;

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX - crosshairSize, centerY);
        ctx.lineTo(centerX + crosshairSize, centerY);
        ctx.moveTo(centerX, centerY - crosshairSize);
        ctx.lineTo(centerX, centerY + crosshairSize);
        ctx.stroke();
      }
    };
    img.src = screenshot.imageData;
  }, [
    screenshot,
    matches,
    scale,
    selectedMatch,
    showRegions,
    highlightBest,
    showScores,
  ]);

  const performFind = async () => {
    const imageId = stateImage?.patterns?.[0]?.imageId;
    if (!stateImage || !imageId || !apiConnected) return;

    setIsSearching(true);
    const startTime = Date.now();

    try {
      const result = await testStateImage(screenshot, imageId, similarity);

      if (result.found && result.matches) {
        const foundMatches: FindMatch[] = result.matches.map((m: unknown) => ({
          region: m.region,
          score: m.score,
          label: stateImage.name,
        }));

        setMatches(foundMatches);

        // Calculate statistics
        if (foundMatches.length > 0) {
          const scores = foundMatches.map((m) => m.score);
          setBestScore(Math.max(...scores));
          setAvgScore(scores.reduce((a, b) => a + b, 0) / scores.length);
        }

        if (onMatchesFound) {
          onMatchesFound(foundMatches);
        }
      } else {
        setMatches([]);
        setBestScore(0);
        setAvgScore(0);
      }

      setSearchTime(Date.now() - startTime);
    } catch (error) {
      console.error("Find operation failed:", error);
      setMatches([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleZoomIn = () => setScale(Math.min(scale * 1.2, 3));
  const handleZoomOut = () => setScale(Math.max(scale / 1.2, 0.3));
  const handleFitToScreen = () => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 40;
    const containerHeight = containerRef.current.clientHeight - 200;
    const scaleX = containerWidth / screenshot.width;
    const scaleY = containerHeight / screenshot.height;
    setScale(Math.min(scaleX, scaleY, 1));
  };

  const exportResults = () => {
    const results = {
      screenshot: screenshot.name,
      stateImage: stateImage?.name,
      similarity,
      searchTime,
      matches: matches.map((m) => ({
        region: m.region,
        score: m.score,
      })),
      statistics: {
        totalMatches: matches.length,
        bestScore,
        avgScore,
      },
    };

    const blob = new Blob([JSON.stringify(results, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `find-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="font-semibold">Find Operation Visualizer</h3>
              <p className="text-xs text-gray-600">
                {apiConnected
                  ? "Using real Qontinui pattern matching"
                  : "API not connected"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowControls(!showControls)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              {showControls ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      {showControls && (
        <div className="bg-white border-b px-4 py-3 space-y-3">
          {/* Similarity Slider */}
          <div className="flex items-center gap-4">
            <Sliders className="w-4 h-4 text-gray-500" />
            <label className="text-sm font-medium">Similarity:</label>
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={similarity}
              onChange={(e) => setSimilarity(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm font-mono w-12">
              {(similarity * 100).toFixed(0)}%
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={performFind}
              disabled={!stateImage || !apiConnected || isSearching}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium ${
                !stateImage || !apiConnected || isSearching
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
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
                  Run Find
                </>
              )}
            </button>

            <div className="flex items-center gap-1 border-l pl-2">
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-gray-100 rounded-lg"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={handleFitToScreen}
                className="p-2 hover:bg-gray-100 rounded-lg"
                title="Fit to Screen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-gray-100 rounded-lg"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono px-2">
                {Math.round(scale * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2 border-l pl-2">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={showRegions}
                  onChange={(e) => setShowRegions(e.target.checked)}
                  className="w-4 h-4"
                />
                Regions
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={showScores}
                  onChange={(e) => setShowScores(e.target.checked)}
                  className="w-4 h-4"
                />
                Scores
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={highlightBest}
                  onChange={(e) => setHighlightBest(e.target.checked)}
                  className="w-4 h-4"
                />
                Highlight Best
              </label>
            </div>

            {matches.length > 0 && (
              <button
                onClick={exportResults}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2 text-sm"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
          </div>

          {/* Statistics */}
          {matches.length > 0 && (
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-gray-500" />
                <span>
                  Matches: <strong>{matches.length}</strong>
                </span>
              </div>
              <div>
                Best Score:{" "}
                <strong className="text-green-600">
                  {(bestScore * 100).toFixed(1)}%
                </strong>
              </div>
              <div>
                Avg Score: <strong>{(avgScore * 100).toFixed(1)}%</strong>
              </div>
              <div>
                Search Time: <strong>{searchTime}ms</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-4 overflow-auto"
      >
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="border border-gray-300 shadow-lg"
            style={{ cursor: "crosshair" }}
            onClick={(e) => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = (e.clientX - rect.left) / scale;
              const y = (e.clientY - rect.top) / scale;

              // Find clicked match
              const clicked = matches.find(
                (m) =>
                  x >= m.region.x &&
                  x <= m.region.x + m.region.width &&
                  y >= m.region.y &&
                  y <= m.region.y + m.region.height
              );

              setSelectedMatch(clicked || null);
            }}
          />

          {/* Selected Match Info */}
          {selectedMatch && (
            <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white p-3 rounded-lg text-sm max-w-xs">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4" />
                <span className="font-medium">Match Details</span>
              </div>
              <div className="space-y-1 text-xs">
                <div>
                  Score:{" "}
                  <strong>{(selectedMatch.score * 100).toFixed(2)}%</strong>
                </div>
                <div>
                  Position: ({selectedMatch.region.x}, {selectedMatch.region.y})
                </div>
                <div>
                  Size: {selectedMatch.region.width} ×{" "}
                  {selectedMatch.region.height}
                </div>
                <div>
                  Center: (
                  {Math.round(
                    selectedMatch.region.x + selectedMatch.region.width / 2
                  )}
                  ,{" "}
                  {Math.round(
                    selectedMatch.region.y + selectedMatch.region.height / 2
                  )}
                  )
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Match List */}
      {matches.length > 0 && (
        <div className="bg-white border-t max-h-48 overflow-y-auto">
          <div className="p-3">
            <h4 className="text-sm font-medium mb-2">Found Matches</h4>
            <div className="grid grid-cols-4 gap-2">
              {matches.map((match, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedMatch(match)}
                  className={`p-2 rounded-lg border text-xs transition-colors ${
                    selectedMatch === match
                      ? "bg-blue-50 border-blue-300"
                      : "hover:bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">Match #{index + 1}</span>
                    <span
                      className={`font-mono ${
                        match.score >= 0.9
                          ? "text-green-600"
                          : match.score >= 0.8
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                    >
                      {(match.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-gray-600">
                    ({match.region.x}, {match.region.y})
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FindOperationVisualizer;
