/**
 * Results Panel
 *
 * Right panel displaying the extracted image and mask with action buttons.
 */

import React from "react";
import { Scissors, Plus, Edit } from "lucide-react";
import type {
  ExtractionResultData,
  ProcessingMode,
} from "@/hooks/use-image-extraction";
import type { Region } from "@/types/pattern-optimization";

interface ResultsPanelProps {
  extractedResult: ExtractionResultData | null;
  processingMode: ProcessingMode;
  tolerance: number;
  selectedRegion: Region | null;
  onEditMask: () => void;
  onSave: () => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  extractedResult,
  processingMode,
  tolerance,
  selectedRegion,
  onEditMask,
  onSave,
}) => {
  return (
    <div className="w-80 bg-[#27272A]/50 border-l border-gray-800 flex flex-col">
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <h2 className="font-semibold text-white">Extracted Image</h2>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        {extractedResult ? (
          <div className="space-y-4">
            {/* Extracted Image */}
            <div>
              <h3 className="text-sm font-medium text-gray-300 mb-2">Image</h3>
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
                {extractedResult.bounds.width}×{extractedResult.bounds.height}{" "}
                pixels
              </p>
            </div>

            {/* Mask (if available) */}
            {extractedResult.mask && (
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">Mask</h3>
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
                {processingMode !== "none" && <li>Tolerance: {tolerance}</li>}
                {selectedRegion && (
                  <li>
                    Original bounds: {Math.round(selectedRegion.x)},{" "}
                    {Math.round(selectedRegion.y)}
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
                onClick={onEditMask}
                className="w-full px-4 py-2.5 bg-[#BD00FF] text-white rounded-md hover:bg-[#BD00FF]/90 font-medium flex items-center justify-center gap-2"
              >
                <Edit className="w-4 h-4" />
                Edit Mask
              </button>
              <button
                onClick={onSave}
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
  );
};
