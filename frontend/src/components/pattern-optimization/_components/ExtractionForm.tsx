import React from "react";
import { StateImage } from "../../../types/stateDiscovery";
import { PatternExtractionConfig } from "../types";

interface ExtractionFormProps {
  stateImages: StateImage[];
  selectedStateImage: StateImage | null;
  onSelectStateImage: (si: StateImage | null) => void;
  patternName: string;
  onPatternNameChange: (name: string) => void;
  extractionConfig: PatternExtractionConfig;
  onExtractionConfigChange: (
    updater: (prev: PatternExtractionConfig) => PatternExtractionConfig
  ) => void;
  isExtracting: boolean;
  onExtract: () => void;
}

export const ExtractionForm: React.FC<ExtractionFormProps> = ({
  stateImages,
  selectedStateImage,
  onSelectStateImage,
  patternName,
  onPatternNameChange,
  extractionConfig,
  onExtractionConfigChange,
  isExtracting,
  onExtract,
}) => (
  <div className="border-t pt-4">
    <h3 className="text-sm font-semibold mb-3">Extract New Pattern</h3>

    <select
      value={selectedStateImage?.id || ""}
      onChange={(e) => {
        const si = stateImages.find((s) => s.id === e.target.value);
        onSelectStateImage(si || null);
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
      onChange={(e) => onPatternNameChange(e.target.value)}
      className="w-full text-sm border rounded px-2 py-1.5 mb-3"
    />

    {/* Similarity Threshold Slider */}
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <label
          htmlFor="potr-similarity-threshold"
          className="text-xs font-medium text-text-secondary"
        >
          Similarity Threshold
        </label>
        <span className="text-xs font-mono bg-surface-raised px-1.5 py-0.5 rounded">
          {(extractionConfig.similarityThreshold * 100).toFixed(0)}%
        </span>
      </div>
      <input
        id="potr-similarity-threshold"
        type="range"
        min="50"
        max="100"
        value={extractionConfig.similarityThreshold * 100}
        onChange={(e) =>
          onExtractionConfigChange((prev) => ({
            ...prev,
            similarityThreshold: Number(e.target.value) / 100,
          }))
        }
        className="w-full"
      />
      <div className="flex justify-between text-xs text-text-muted mt-1">
        <span>Less strict</span>
        <span>More strict</span>
      </div>
    </div>

    {/* Color Averaging Method */}
    <div className="mb-3">
      <label
        htmlFor="potr-color-averaging"
        className="text-xs font-medium text-text-secondary block mb-1"
      >
        Pixel Averaging Method
      </label>
      <select
        id="potr-color-averaging"
        value={extractionConfig.colorAveraging}
        onChange={(e) =>
          onExtractionConfigChange((prev) => ({
            ...prev,
            colorAveraging: e.target.value as
              | "mean"
              | "median"
              | "mode"
              | "weighted",
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
            onExtractionConfigChange((prev) => ({
              ...prev,
              morphologicalOps: {
                ...prev.morphologicalOps,
                enabled: e.target.checked,
              },
            }))
          }
          className="mr-2"
        />
        <span className="font-medium text-text-secondary">Clean up mask</span>
      </label>
      {extractionConfig.morphologicalOps.enabled && (
        <div className="ml-6 mt-1 text-xs text-text-muted">
          Removes noise and fills gaps
        </div>
      )}
    </div>

    <button
      onClick={onExtract}
      disabled={!selectedStateImage || !patternName || isExtracting}
      className="w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm font-medium"
    >
      {isExtracting ? "Extracting..." : "Extract Pattern"}
    </button>
  </div>
);
