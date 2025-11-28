import React, { useState, useEffect, useCallback } from "react";
import { StateImage } from "../../types/stateDiscovery";
import { MaskVisualization } from "../masks/MaskVisualization";

interface MaskedPattern {
  id: string;
  name: string;
  width: number;
  height: number;
  mask: Uint8Array; // Binary mask for confidence
  averagedPixels: Uint8Array; // RGBA averaged pixel values
  similarityThreshold: number; // Threshold used to create the mask
  confidenceMap: Float32Array; // Per-pixel confidence values (0-1)
  maskDensity: number; // Percentage of pixels above threshold
  activePixels: number;
  totalPixels: number;
  sourceStateImageId?: string;
  createdAt: string;
  updatedAt: string;

  // Performance metrics
  matchCount: number;
  successRate: number;
  avgMatchTime: number;

  // Pattern statistics
  minConfidence: number;
  maxConfidence: number;
  avgConfidence: number;
  stdDevConfidence: number;
}

interface PatternExtractionConfig {
  similarityThreshold: number; // 0-1, pixels below this are masked out
  minActivePixels: number; // Minimum number of active pixels required
  colorAveraging: "mean" | "median" | "mode" | "weighted"; // How to average pixel values
  useAlphaChannel: boolean; // Whether to include alpha in averaging
  morphologicalOps: {
    enabled: boolean;
    erosionSize: number; // Remove small isolated pixels
    dilationSize: number; // Fill small gaps
  };
}

export const PatternOptimizationTabRefactored: React.FC = () => {
  const [patterns, setPatterns] = useState<MaskedPattern[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<MaskedPattern | null>(
    null
  );
  const [stateImages, setStateImages] = useState<StateImage[]>([]);
  const [selectedStateImage, setSelectedStateImage] =
    useState<StateImage | null>(null);

  // Pattern extraction configuration
  const [extractionConfig, setExtractionConfig] =
    useState<PatternExtractionConfig>({
      similarityThreshold: 0.85,
      minActivePixels: 100,
      colorAveraging: "weighted",
      useAlphaChannel: false,
      morphologicalOps: {
        enabled: true,
        erosionSize: 1,
        dilationSize: 2,
      },
    });

  const [isExtracting, setIsExtracting] = useState(false);
  const [patternName, setPatternName] = useState("");
  const [showConfidenceMap, setShowConfidenceMap] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.5);

  // Live preview of threshold changes
  const [previewThreshold, setPreviewThreshold] = useState(0.85);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  useEffect(() => {
    fetchPatterns();
    fetchStateImages();
  }, []);

  const fetchPatterns = async () => {
    try {
      const response = await fetch("/api/masks/patterns/masked");
      if (response.ok) {
        const data = await response.json();
        setPatterns(data);
      }
    } catch (error) {
      console.error("Failed to fetch masked patterns:", error);
    }
  };

  const fetchStateImages = async () => {
    try {
      // Fetch state images from the current project/analysis
      const response = await fetch("/api/state-discovery/state-images");
      if (response.ok) {
        const data = await response.json();
        setStateImages(data.state_images || []);
      }
    } catch (error) {
      console.error("Failed to fetch state images:", error);
    }
  };

  const extractMaskedPattern = async () => {
    if (!selectedStateImage || !patternName) return;

    setIsExtracting(true);
    try {
      const response = await fetch("/api/masks/patterns/extract-masked", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state_image_id: selectedStateImage.id,
          pattern_name: patternName,
          config: extractionConfig,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Masked pattern extracted:", data);
        fetchPatterns(); // Refresh patterns list
        setPatternName("");
        setSelectedStateImage(null);
      }
    } catch (error) {
      console.error("Failed to extract masked pattern:", error);
    } finally {
      setIsExtracting(false);
    }
  };

  const updatePatternThreshold = async (
    patternId: string,
    newThreshold: number
  ) => {
    try {
      const response = await fetch(
        `/api/masks/patterns/${patternId}/update-threshold`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            similarity_threshold: newThreshold,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log("Pattern threshold updated:", data);
        fetchPatterns(); // Refresh to get updated pattern
      }
    } catch (error) {
      console.error("Failed to update pattern threshold:", error);
    }
  };

  const analyzePatternQuality = useCallback((pattern: MaskedPattern) => {
    const density = pattern.maskDensity;
    const avgConf = pattern.avgConfidence;
    const stdDev = pattern.stdDevConfidence;

    // Calculate quality score
    let quality = "Poor";
    let qualityColor = "text-red-600";
    const recommendations: string[] = [];

    if (density < 0.1) {
      recommendations.push(
        "Very low mask density - consider lowering similarity threshold"
      );
    } else if (density > 0.9) {
      recommendations.push(
        "Very high mask density - pattern may be too general"
      );
    }

    if (stdDev > 0.3) {
      recommendations.push(
        "High confidence variance - pattern may be inconsistent"
      );
    }

    if (avgConf >= 0.9 && density >= 0.3 && density <= 0.8 && stdDev <= 0.15) {
      quality = "Excellent";
      qualityColor = "text-green-600";
    } else if (avgConf >= 0.75 && density >= 0.2 && stdDev <= 0.25) {
      quality = "Good";
      qualityColor = "text-blue-600";
    } else if (avgConf >= 0.6) {
      quality = "Fair";
      qualityColor = "text-yellow-600";
    }

    return { quality, qualityColor, recommendations };
  }, []);

  return (
    <div className="pattern-optimization-tab-refactored p-4">
      <div className="grid grid-cols-12 gap-4">
        {/* Pattern List */}
        <div className="col-span-3 bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-3">Masked Patterns</h2>

          <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
            {patterns.map((pattern) => {
              const analysis = analyzePatternQuality(pattern);
              return (
                <div
                  key={pattern.id}
                  onClick={() => setSelectedPattern(pattern)}
                  className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedPattern?.id === pattern.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200"
                  }`}
                >
                  <div className="font-medium text-sm">{pattern.name}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {pattern.width}×{pattern.height} • Density:{" "}
                    {(pattern.maskDensity * 100).toFixed(1)}%
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span
                      className={`text-xs font-medium ${analysis.qualityColor}`}
                    >
                      {analysis.quality}
                    </span>
                    <span className="text-xs text-gray-500">
                      θ={pattern.similarityThreshold.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-400 to-green-500"
                        style={{ width: `${pattern.avgConfidence * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Extract New Pattern</h3>

            <select
              value={selectedStateImage?.id || ""}
              onChange={(e) => {
                const si = stateImages.find((s) => s.id === e.target.value);
                setSelectedStateImage(si || null);
              }}
              className="w-full text-sm border rounded px-2 py-1.5 mb-2"
            >
              <option value="">Select StateImage...</option>
              {stateImages.map((si) => (
                <option key={si.id} value={si.id}>
                  {si.name || si.id}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Pattern name"
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
              className="w-full text-sm border rounded px-2 py-1.5 mb-3"
            />

            {/* Similarity Threshold Slider */}
            <div className="mb-3">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium text-gray-700">
                  Similarity Threshold
                </label>
                <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                  {(extractionConfig.similarityThreshold * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                value={extractionConfig.similarityThreshold * 100}
                onChange={(e) =>
                  setExtractionConfig((prev) => ({
                    ...prev,
                    similarityThreshold: Number(e.target.value) / 100,
                  }))
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Less strict</span>
                <span>More strict</span>
              </div>
            </div>

            {/* Color Averaging Method */}
            <div className="mb-3">
              <label className="text-xs font-medium text-gray-700 block mb-1">
                Pixel Averaging Method
              </label>
              <select
                value={extractionConfig.colorAveraging}
                onChange={(e) =>
                  setExtractionConfig((prev) => ({
                    ...prev,
                    colorAveraging: e.target.value as any,
                  }))
                }
                className="w-full text-xs border rounded px-2 py-1"
              >
                <option value="mean">Mean (Average)</option>
                <option value="median">Median</option>
                <option value="weighted">Weighted by Confidence</option>
                <option value="mode">Mode (Most Common)</option>
              </select>
            </div>

            {/* Morphological Operations */}
            <div className="mb-3">
              <label className="flex items-center text-xs">
                <input
                  type="checkbox"
                  checked={extractionConfig.morphologicalOps.enabled}
                  onChange={(e) =>
                    setExtractionConfig((prev) => ({
                      ...prev,
                      morphologicalOps: {
                        ...prev.morphologicalOps,
                        enabled: e.target.checked,
                      },
                    }))
                  }
                  className="mr-2"
                />
                <span className="font-medium text-gray-700">Clean up mask</span>
              </label>
              {extractionConfig.morphologicalOps.enabled && (
                <div className="ml-6 mt-1 text-xs text-gray-600">
                  Removes noise and fills gaps
                </div>
              )}
            </div>

            <button
              onClick={extractMaskedPattern}
              disabled={!selectedStateImage || !patternName || isExtracting}
              className="w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm font-medium"
            >
              {isExtracting ? "Extracting..." : "Extract Pattern"}
            </button>
          </div>
        </div>

        {/* Pattern Details and Visualization */}
        <div className="col-span-9 bg-white rounded-lg shadow p-4">
          {selectedPattern ? (
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="flex justify-between items-start mb-4 pb-4 border-b">
                <div>
                  <h2 className="text-xl font-semibold">
                    {selectedPattern.name}
                  </h2>
                  <div className="text-sm text-gray-600 mt-1">
                    ID: {selectedPattern.id} • Created:{" "}
                    {new Date(selectedPattern.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowConfidenceMap(!showConfidenceMap)}
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      showConfidenceMap
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {showConfidenceMap ? "Hide" : "Show"} Confidence
                  </button>
                  <button
                    onClick={() => setIsPreviewMode(!isPreviewMode)}
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      isPreviewMode
                        ? "bg-green-500 text-white"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {isPreviewMode ? "Exit Preview" : "Preview Mode"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 flex-1">
                {/* Statistics */}
                <div className="col-span-1 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">
                      Pattern Statistics
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Dimensions:</span>
                        <span className="font-mono">
                          {selectedPattern.width}×{selectedPattern.height}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Pixels:</span>
                        <span className="font-mono">
                          {selectedPattern.totalPixels.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Active Pixels:</span>
                        <span className="font-mono text-green-600">
                          {selectedPattern.activePixels.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Mask Density:</span>
                        <span className="font-mono">
                          {(selectedPattern.maskDensity * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2">
                      Confidence Metrics
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Threshold:</span>
                        <span className="font-mono">
                          {(selectedPattern.similarityThreshold * 100).toFixed(
                            0
                          )}
                          %
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Min Confidence:</span>
                        <span className="font-mono text-red-600">
                          {(selectedPattern.minConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Avg Confidence:</span>
                        <span className="font-mono text-blue-600">
                          {(selectedPattern.avgConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Max Confidence:</span>
                        <span className="font-mono text-green-600">
                          {(selectedPattern.maxConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Std Deviation:</span>
                        <span className="font-mono">
                          {(selectedPattern.stdDevConfidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Threshold Adjustment */}
                  {isPreviewMode && (
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <h3 className="text-sm font-semibold mb-2">
                        Adjust Threshold
                      </h3>
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-xs font-medium">
                            New Threshold
                          </label>
                          <span className="text-xs font-mono bg-white px-1.5 py-0.5 rounded">
                            {(previewThreshold * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="50"
                          max="100"
                          value={previewThreshold * 100}
                          onChange={(e) =>
                            setPreviewThreshold(Number(e.target.value) / 100)
                          }
                          className="w-full"
                        />
                      </div>
                      <button
                        onClick={() =>
                          updatePatternThreshold(
                            selectedPattern.id,
                            previewThreshold
                          )
                        }
                        className="w-full px-2 py-1 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600"
                      >
                        Apply New Threshold
                      </button>
                    </div>
                  )}

                  {/* Quality Analysis */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">
                      Quality Analysis
                    </h3>
                    {(() => {
                      const analysis = analyzePatternQuality(selectedPattern);
                      return (
                        <div>
                          <div
                            className={`text-lg font-bold mb-2 ${analysis.qualityColor}`}
                          >
                            {analysis.quality}
                          </div>
                          {analysis.recommendations.length > 0 && (
                            <div className="space-y-1">
                              {analysis.recommendations.map((rec, i) => (
                                <div
                                  key={i}
                                  className="text-xs text-gray-600 flex items-start"
                                >
                                  <span className="mr-1">•</span>
                                  <span>{rec}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Visualizations */}
                <div className="col-span-2 space-y-4">
                  {/* Pattern Visualization */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">
                      Pattern Visualization
                    </h3>
                    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      <div className="relative">
                        {/* Averaged Pattern Image */}
                        <div className="bg-checkerboard rounded">
                          <canvas
                            id="pattern-canvas"
                            width={selectedPattern.width}
                            height={selectedPattern.height}
                            className="max-w-full h-auto border border-gray-300"
                          />
                        </div>

                        {/* Confidence Overlay */}
                        {showConfidenceMap && (
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{ opacity: maskOpacity }}
                          >
                            <canvas
                              id="confidence-canvas"
                              width={selectedPattern.width}
                              height={selectedPattern.height}
                              className="max-w-full h-auto"
                            />
                          </div>
                        )}
                      </div>

                      {/* Opacity Control */}
                      {showConfidenceMap && (
                        <div className="mt-3">
                          <div className="flex justify-between items-center">
                            <label className="text-xs font-medium text-gray-600">
                              Confidence Overlay Opacity
                            </label>
                            <span className="text-xs font-mono bg-white px-1.5 py-0.5 rounded">
                              {(maskOpacity * 100).toFixed(0)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={maskOpacity * 100}
                            onChange={(e) =>
                              setMaskOpacity(Number(e.target.value) / 100)
                            }
                            className="w-full mt-1"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Confidence Distribution */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">
                      Confidence Distribution
                    </h3>
                    <div className="border border-gray-200 rounded-lg p-4 bg-white">
                      <div className="h-32">
                        {/* Histogram visualization would go here */}
                        <div className="h-full flex items-end justify-between gap-1">
                          {Array.from({ length: 20 }, (_, i) => {
                            const binStart = i / 20;
                            const binEnd = (i + 1) / 20;
                            // Calculate histogram height (mock data for now)
                            const height = Math.random() * 100;
                            const isActive =
                              binEnd > selectedPattern.similarityThreshold;

                            return (
                              <div
                                key={i}
                                className={`flex-1 rounded-t transition-colors ${
                                  isActive ? "bg-green-500" : "bg-gray-300"
                                }`}
                                style={{ height: `${height}%` }}
                                title={`${(binStart * 100).toFixed(0)}%-${(binEnd * 100).toFixed(0)}%`}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-2">
                        <span>0%</span>
                        <span>Confidence</span>
                        <span>100%</span>
                      </div>
                      <div
                        className="relative mt-1"
                        style={{
                          marginLeft: `${selectedPattern.similarityThreshold * 100}%`,
                        }}
                      >
                        <div className="absolute -left-px w-0.5 h-4 bg-red-500" />
                        <div className="absolute -left-12 top-5 text-xs text-red-600 font-medium whitespace-nowrap">
                          Threshold:{" "}
                          {(selectedPattern.similarityThreshold * 100).toFixed(
                            0
                          )}
                          %
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Performance Metrics */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">
                      Performance Metrics
                    </h3>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="border border-gray-200 rounded-lg p-3 bg-white">
                        <div className="text-2xl font-bold text-blue-600">
                          {selectedPattern.matchCount}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Total Matches
                        </div>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3 bg-white">
                        <div className="text-2xl font-bold text-green-600">
                          {(selectedPattern.successRate * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Success Rate
                        </div>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3 bg-white">
                        <div className="text-2xl font-bold text-purple-600">
                          {selectedPattern.avgMatchTime.toFixed(1)}ms
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Avg Match Time
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <svg
                  className="w-16 h-16 mx-auto mb-4 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
                <p className="text-lg font-medium">No Pattern Selected</p>
                <p className="text-sm mt-1">
                  Select a pattern from the list to view details
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSS for checkerboard background */}
      <style jsx>{`
        .bg-checkerboard {
          background-image:
            linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
            linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
          background-size: 20px 20px;
          background-position:
            0 0,
            0 10px,
            10px -10px,
            -10px 0px;
        }
      `}</style>
    </div>
  );
};
