/**
 * Screenshot Panel
 *
 * Left panel for screenshot selection, upload, and multi-monitor capture.
 * Displays captured screenshot info and thumbnails for composite mode.
 */

import React, { useCallback } from "react";
import { Monitor, Trash2 } from "lucide-react";
import {
  ScreenshotPicker,
  type CapturedScreenshot,
} from "@/components/common/ScreenshotPicker";
import type {
  ScreenshotData,
  CompositeScreenshotData,
} from "@/hooks/use-image-extraction";

interface ScreenshotPanelProps {
  currentScreenshot: ScreenshotData | null;
  compositeScreenshots: CompositeScreenshotData[];
  isCompositeMode: boolean;
  selectedRegion: { width: number; height: number } | null;
  onUploadScreenshot: (file: File) => Promise<void>;
  onCaptureMultipleScreenshots: (
    screenshots: CapturedScreenshot[]
  ) => Promise<void>;
  onClearAll: () => void;
  onSelectScreenshot?: (screenshot: ScreenshotData) => void;
}

export const ScreenshotPanel: React.FC<ScreenshotPanelProps> = ({
  currentScreenshot,
  compositeScreenshots,
  isCompositeMode,
  selectedRegion,
  onUploadScreenshot,
  onCaptureMultipleScreenshots,
  onClearAll,
  onSelectScreenshot,
}) => {
  // Handle file upload
  const handleUpload = useCallback(
    (file: File) => {
      onUploadScreenshot(file);
    },
    [onUploadScreenshot]
  );

  // Handle clearing the current screenshot
  const handleClear = useCallback(() => {
    onClearAll();
  }, [onClearAll]);

  // Handle selecting from project screenshots (placeholder - integrate with automation context)
  const handleSelectProjectScreenshot = useCallback(
    async (screenshotId: string) => {
      // This would need integration with the automation context
      console.log("Select project screenshot:", screenshotId);
    },
    []
  );

  return (
    <div className="w-64 bg-[#27272A]/50 border-r border-gray-800 flex flex-col overflow-y-auto">
      <ScreenshotPicker
        currentScreenshot={
          currentScreenshot
            ? {
                id: currentScreenshot.id,
                name: currentScreenshot.name,
                url: currentScreenshot.dataUrl,
              }
            : null
        }
        onUploadScreenshot={handleUpload}
        onCaptureMultipleScreenshots={onCaptureMultipleScreenshots}
        onSelectProjectScreenshot={handleSelectProjectScreenshot}
        onClearScreenshot={handleClear}
        showRegionInfo={true}
        regionDimensions={
          selectedRegion
            ? {
                width: selectedRegion.width,
                height: selectedRegion.height,
              }
            : null
        }
        additionalInfo={
          <div className="bg-[#27272A] rounded-lg p-3 border border-gray-700">
            <h3 className="text-xs font-medium text-gray-300 mb-2">
              {isCompositeMode ? "Multi-Monitor Mode" : "Instructions"}
            </h3>
            {isCompositeMode ? (
              <div className="text-xs text-gray-400 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[#00D9FF]">
                    <Monitor className="w-3 h-3" />
                    <span>{compositeScreenshots.length} monitors captured</span>
                  </div>
                  <button
                    onClick={onClearAll}
                    className="text-gray-400 hover:text-red-400 flex items-center gap-1"
                    title="Clear all screenshots and start fresh"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                </div>
                <p>
                  Draw a region across monitors to extract images that span
                  multiple screens.
                </p>
              </div>
            ) : (
              <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                <li>Draw a selection box on the image</li>
                <li>Choose processing mode</li>
                <li>Click "Extract Image"</li>
                <li>Create StateImage from result</li>
              </ol>
            )}
          </div>
        }
        className="flex-1 flex flex-col"
      />

      {/* Composite Screenshots Thumbnail Strip */}
      {isCompositeMode && compositeScreenshots.length > 1 && (
        <div className="p-4 border-t border-gray-800">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-medium text-gray-300">
              Monitors ({compositeScreenshots.length})
            </h3>
            <button
              onClick={onClearAll}
              className="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1"
              title="Clear all captured screenshots"
            >
              <Trash2 className="w-3 h-3" />
              Clear All
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {compositeScreenshots.map((screenshot) => (
              <button
                key={screenshot.id}
                onClick={() =>
                  onSelectScreenshot?.({
                    id: screenshot.id,
                    name: screenshot.name,
                    dataUrl: screenshot.dataUrl,
                    width: screenshot.width,
                    height: screenshot.height,
                  })
                }
                className={`relative flex-shrink-0 w-16 h-12 rounded border-2 overflow-hidden transition-all ${
                  currentScreenshot?.id === screenshot.id
                    ? "border-[#00D9FF] ring-2 ring-[#00D9FF]/30"
                    : "border-gray-600 hover:border-gray-500"
                }`}
                title={`Monitor ${screenshot.monitor.index}`}
              >
                <img
                  src={screenshot.dataUrl}
                  alt={screenshot.name}
                  className="w-full h-full object-cover"
                />
                {currentScreenshot?.id === screenshot.id && (
                  <div className="absolute inset-0 bg-[#00D9FF]/20" />
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-white text-center">
                  {screenshot.monitor.index}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Click to preview individual monitors
          </p>
        </div>
      )}
    </div>
  );
};
