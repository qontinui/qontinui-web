"use client";

import React from "react";
import type { ExtractionConfig } from "@/types/pattern-optimization";
import { Sliders, AlertCircle } from "lucide-react";

/** The subset of ExtractionConfig exposed through the bridge (no minActivePixels). */
type BridgeConfig = Omit<ExtractionConfig, "minActivePixels">;

interface ExtractionConfigPanelProps {
  config: BridgeConfig;
  onConfigChange: (config: BridgeConfig) => void;
  canExtract: boolean;
  isExtracting: boolean;
  hasRequirements: boolean;
  hasScreenshots: boolean;
  onExtract: () => void;
}

export const ExtractionConfigPanel: React.FC<ExtractionConfigPanelProps> = ({
  config,
  onConfigChange,
  canExtract,
  isExtracting,
  hasRequirements,
  hasScreenshots,
  onExtract,
}) => {
  return (
    <div className="w-64 bg-surface-raised/50 border-r border-border-subtle p-4">
      <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
        <Sliders className="w-4 h-4" />
        Extraction Configuration
      </h2>

      <div className="space-y-4">
        {/* Similarity Threshold */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label
              htmlFor="pos-similarity-threshold"
              className="text-sm font-medium text-text-secondary"
            >
              Similarity Threshold
            </label>
            <span className="text-sm font-mono bg-surface-canvas px-2 py-1 rounded text-text-secondary">
              {(config.similarityThreshold * 100).toFixed(0)}%
            </span>
          </div>
          <input
            id="pos-similarity-threshold"
            type="range"
            min="50"
            max="100"
            value={config.similarityThreshold * 100}
            onChange={(e) =>
              onConfigChange({
                ...config,
                similarityThreshold: Number(e.target.value) / 100,
              })
            }
            className="w-full"
          />
          <div className="flex justify-between text-xs text-text-muted mt-1">
            <span>More inclusive</span>
            <span>More strict</span>
          </div>
          <p className="text-xs text-text-muted mt-2">
            Pixels with confidence below this threshold will be masked out
          </p>
        </div>

        {/* Color Averaging */}
        <div>
          <label
            htmlFor="pos-color-averaging"
            className="text-sm font-medium text-text-secondary block mb-2"
          >
            Color Averaging Method
          </label>
          <select
            id="pos-color-averaging"
            value={config.colorAveraging}
            onChange={(e) =>
              onConfigChange({
                ...config,
                colorAveraging: e.target.value as
                  | "mean"
                  | "median"
                  | "weighted",
              })
            }
            className="w-full bg-surface-canvas border border-border-default rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="mean">Mean (Simple Average)</option>
            <option value="median">Median (Robust to Outliers)</option>
            <option value="weighted">Weighted by Confidence</option>
          </select>
          <p className="text-xs text-text-muted mt-2">
            {config.colorAveraging === "weighted"
              ? "Pixels are weighted by their stability across screenshots"
              : config.colorAveraging === "median"
                ? "Uses the middle value, ignoring extreme variations"
                : "Simple average of all pixel values"}
          </p>
        </div>

        {/* Morphological Operations */}
        <div>
          <label className="flex items-center text-sm font-medium text-text-secondary">
            <input
              type="checkbox"
              checked={config.morphologicalOps.enabled}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  morphologicalOps: {
                    ...config.morphologicalOps,
                    enabled: e.target.checked,
                  },
                })
              }
              className="mr-2"
            />
            Clean Mask
          </label>
          {config.morphologicalOps.enabled && (
            <div className="mt-3 ml-6 space-y-3">
              <div>
                <label
                  htmlFor="pos-erosion-size"
                  className="text-xs text-text-muted"
                >
                  Erosion (remove noise)
                </label>
                <input
                  id="pos-erosion-size"
                  type="range"
                  min="0"
                  max="5"
                  value={config.morphologicalOps.erosionSize}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      morphologicalOps: {
                        ...config.morphologicalOps,
                        erosionSize: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label
                  htmlFor="pos-dilation-size"
                  className="text-xs text-text-muted"
                >
                  Dilation (fill gaps)
                </label>
                <input
                  id="pos-dilation-size"
                  type="range"
                  min="0"
                  max="5"
                  value={config.morphologicalOps.dilationSize}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      morphologicalOps: {
                        ...config.morphologicalOps,
                        dilationSize: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
            </div>
          )}
          <p className="text-xs text-text-muted mt-2">
            Removes small isolated pixels and fills small gaps in the mask
          </p>
        </div>

        {/* Extract Button */}
        <div className="pt-4">
          <button
            onClick={onExtract}
            disabled={!canExtract}
            className={`w-full py-2.5 rounded-md font-medium transition-colors ${
              canExtract
                ? "bg-brand-success hover:bg-brand-success/90 text-black"
                : "bg-surface-raised text-text-muted cursor-not-allowed"
            }`}
          >
            {isExtracting ? "Extracting..." : "Extract Pattern"}
          </button>

          {!hasRequirements && hasScreenshots && !isExtracting && (
            <p className="text-xs text-amber-500 flex items-start gap-1 mt-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              Draw a selection box on the screenshot to define the pattern
              region
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
