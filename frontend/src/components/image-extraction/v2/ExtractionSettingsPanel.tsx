/**
 * Extraction Settings Panel
 *
 * Panel for configuring extraction settings: processing mode, tolerance,
 * and the extract button.
 */

import React from "react";
import { Scissors, AlertCircle } from "lucide-react";
import type { ProcessingMode } from "@/services/image-extraction";

interface ExtractionSettingsPanelProps {
  processingMode: ProcessingMode;
  tolerance: number;
  canExtract: boolean;
  hasScreenshot: boolean;
  onProcessingModeChange: (mode: ProcessingMode) => void;
  onToleranceChange: (tolerance: number) => void;
  onExtract: () => void;
}

export const ExtractionSettingsPanel: React.FC<
  ExtractionSettingsPanelProps
> = ({
  processingMode,
  tolerance,
  canExtract,
  hasScreenshot,
  onProcessingModeChange,
  onToleranceChange,
  onExtract,
}) => {
  return (
    <div className="w-64 bg-surface-raised/50 border-r border-border-subtle p-4">
      <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
        <Scissors className="w-4 h-4" />
        Extraction Settings
      </h2>

      <div className="space-y-4">
        {/* Processing Mode */}
        <div>
          <p className="block text-sm font-medium text-text-secondary mb-2">
            Processing Mode
          </p>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                checked={processingMode === "none"}
                onChange={() => onProcessingModeChange("none")}
                className="mr-2"
              />
              <span className="text-sm text-text-secondary">
                None (Full Region)
              </span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                checked={processingMode === "border"}
                onChange={() => onProcessingModeChange("border")}
                className="mr-2"
              />
              <span className="text-sm text-text-secondary">Remove Border</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                checked={processingMode === "background"}
                onChange={() => onProcessingModeChange("background")}
                className="mr-2"
              />
              <span className="text-sm text-text-secondary">
                Remove Background
              </span>
            </label>
          </div>
          <p className="text-xs text-text-muted mt-2">
            {processingMode === "none" && "Extract the entire selected region"}
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
              <label
                htmlFor="esp-tolerance"
                className="text-sm font-medium text-text-secondary"
              >
                Color Tolerance
              </label>
              <span className="text-sm font-mono bg-surface-canvas px-2 py-1 rounded text-text-secondary">
                {tolerance}
              </span>
            </div>
            <input
              id="esp-tolerance"
              type="range"
              min="0"
              max="50"
              value={tolerance}
              onChange={(e) => onToleranceChange(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-text-muted mt-1">
              <span>Strict</span>
              <span>Loose</span>
            </div>
            <p className="text-xs text-text-muted mt-2">
              How similar colors must be to be considered border/background
            </p>
          </div>
        )}

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
            Extract Image
          </button>

          {!canExtract && hasScreenshot && (
            <p className="text-xs text-amber-500 flex items-start gap-1 mt-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              Select a region on the screenshot first
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
