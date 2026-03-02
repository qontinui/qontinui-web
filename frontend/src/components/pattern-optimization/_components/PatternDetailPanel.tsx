import React, { useState } from "react";
import { MaskedPattern, PatternQualityAnalysis } from "../types";

interface PatternDetailPanelProps {
  pattern: MaskedPattern;
  analysis: PatternQualityAnalysis;
  onUpdateThreshold: (patternId: string, newThreshold: number) => void;
}

export const PatternDetailPanel: React.FC<PatternDetailPanelProps> = ({
  pattern,
  analysis,
  onUpdateThreshold,
}) => {
  const [showConfidenceMap, setShowConfidenceMap] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.5);
  const [previewThreshold, setPreviewThreshold] = useState(0.85);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-start mb-4 pb-4 border-b">
        <div>
          <h2 className="text-xl font-semibold">{pattern.name}</h2>
          <div className="text-sm text-text-muted mt-1">
            ID: {pattern.id} • Created:{" "}
            {new Date(pattern.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfidenceMap(!showConfidenceMap)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              showConfidenceMap
                ? "bg-blue-500 text-white"
                : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
            }`}
          >
            {showConfidenceMap ? "Hide" : "Show"} Confidence
          </button>
          <button
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              isPreviewMode
                ? "bg-green-500 text-white"
                : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
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
            <h3 className="text-sm font-semibold mb-2">Pattern Statistics</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Dimensions:</span>
                <span className="font-mono">
                  {pattern.width}×{pattern.height}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Total Pixels:</span>
                <span className="font-mono">
                  {pattern.totalPixels.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Active Pixels:</span>
                <span className="font-mono text-green-600">
                  {pattern.activePixels.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Mask Density:</span>
                <span className="font-mono">
                  {(pattern.maskDensity * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Confidence Metrics</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Threshold:</span>
                <span className="font-mono">
                  {(pattern.similarityThreshold * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Min Confidence:</span>
                <span className="font-mono text-red-600">
                  {(pattern.minConfidence * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Avg Confidence:</span>
                <span className="font-mono text-blue-600">
                  {(pattern.avgConfidence * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Max Confidence:</span>
                <span className="font-mono text-green-600">
                  {(pattern.maxConfidence * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Std Deviation:</span>
                <span className="font-mono">
                  {(pattern.stdDevConfidence * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Threshold Adjustment */}
          {isPreviewMode && (
            <div className="p-3 bg-blue-50 rounded-lg">
              <h3 className="text-sm font-semibold mb-2">Adjust Threshold</h3>
              <div className="mb-2">
                <div className="flex justify-between items-center mb-1">
                  <label
                    htmlFor="potr-preview-threshold"
                    className="text-xs font-medium"
                  >
                    New Threshold
                  </label>
                  <span className="text-xs font-mono bg-white px-1.5 py-0.5 rounded">
                    {(previewThreshold * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  id="potr-preview-threshold"
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
                onClick={() => onUpdateThreshold(pattern.id, previewThreshold)}
                className="w-full px-2 py-1 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600"
              >
                Apply New Threshold
              </button>
            </div>
          )}

          {/* Quality Analysis */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Quality Analysis</h3>
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
                      className="text-xs text-text-muted flex items-start"
                    >
                      <span className="mr-1">•</span>
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Visualizations */}
        <div className="col-span-2 space-y-4">
          {/* Pattern Visualization */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Pattern Visualization
            </h3>
            <div className="border border-border-default rounded-lg p-4 bg-surface-raised">
              <div className="relative">
                {/* Averaged Pattern Image */}
                <div className="bg-checkerboard rounded">
                  <canvas
                    id="pattern-canvas"
                    width={pattern.width}
                    height={pattern.height}
                    className="max-w-full h-auto border border-border-default"
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
                      width={pattern.width}
                      height={pattern.height}
                      className="max-w-full h-auto"
                    />
                  </div>
                )}
              </div>

              {/* Opacity Control */}
              {showConfidenceMap && (
                <div className="mt-3">
                  <div className="flex justify-between items-center">
                    <label
                      htmlFor="potr-mask-opacity"
                      className="text-xs font-medium text-text-muted"
                    >
                      Confidence Overlay Opacity
                    </label>
                    <span className="text-xs font-mono bg-white px-1.5 py-0.5 rounded">
                      {(maskOpacity * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    id="potr-mask-opacity"
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
            <div className="border border-border-default rounded-lg p-4 bg-white">
              <div className="h-32">
                <div className="h-full flex items-end justify-between gap-1">
                  {Array.from({ length: 20 }, (_, i) => {
                    const binStart = i / 20;
                    const binEnd = (i + 1) / 20;
                    const height = Math.random() * 100;
                    const isActive = binEnd > pattern.similarityThreshold;

                    return (
                      <div
                        key={i}
                        className={`flex-1 rounded-t transition-colors ${
                          isActive ? "bg-green-500" : "bg-surface-raised"
                        }`}
                        style={{ height: `${height}%` }}
                        title={`${(binStart * 100).toFixed(0)}%-${(binEnd * 100).toFixed(0)}%`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-between text-xs text-text-muted mt-2">
                <span>0%</span>
                <span>Confidence</span>
                <span>100%</span>
              </div>
              <div
                className="relative mt-1"
                style={{
                  marginLeft: `${pattern.similarityThreshold * 100}%`,
                }}
              >
                <div className="absolute -left-px w-0.5 h-4 bg-red-500" />
                <div className="absolute -left-12 top-5 text-xs text-red-600 font-medium whitespace-nowrap">
                  Threshold: {(pattern.similarityThreshold * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Performance Metrics</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="border border-border-default rounded-lg p-3 bg-white">
                <div className="text-2xl font-bold text-blue-600">
                  {pattern.matchCount}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  Total Matches
                </div>
              </div>
              <div className="border border-border-default rounded-lg p-3 bg-white">
                <div className="text-2xl font-bold text-green-600">
                  {(pattern.successRate * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-text-muted mt-1">Success Rate</div>
              </div>
              <div className="border border-border-default rounded-lg p-3 bg-white">
                <div className="text-2xl font-bold text-purple-600">
                  {pattern.avgMatchTime.toFixed(1)}ms
                </div>
                <div className="text-xs text-text-muted mt-1">
                  Avg Match Time
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
