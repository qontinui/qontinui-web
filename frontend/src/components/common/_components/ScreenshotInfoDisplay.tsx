import React from "react";
import { X, ImageIcon } from "lucide-react";
import type { ScreenshotInfo } from "../_types/screenshot-picker";

interface ScreenshotInfoDisplayProps {
  currentScreenshot: ScreenshotInfo | null;
  onClearScreenshot: () => void;
  showRegionInfo?: boolean;
  regionDimensions?: { width: number; height: number } | null;
  additionalInfo?: React.ReactNode;
}

export const ScreenshotInfoDisplay: React.FC<ScreenshotInfoDisplayProps> = ({
  currentScreenshot,
  onClearScreenshot,
  showRegionInfo = false,
  regionDimensions,
  additionalInfo,
}) => {
  if (!currentScreenshot) {
    return (
      <div className="text-center py-8">
        <ImageIcon className="w-12 h-12 mx-auto mb-2 text-text-muted/50" />
        <p className="text-sm text-text-muted">No screenshot loaded</p>
        <p className="text-xs text-text-muted/80 mt-1">
          Upload or select from project
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-3 border border-brand-primary bg-brand-primary/10 rounded-lg">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 min-w-0">
            <div
              className="font-medium text-sm text-white truncate"
              title={currentScreenshot.name}
            >
              {currentScreenshot.name}
            </div>
          </div>
          <button
            onClick={onClearScreenshot}
            className="ml-2 p-1 hover:bg-brand-primary/20 rounded transition-colors flex-shrink-0"
            title="Clear screenshot"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        {showRegionInfo && regionDimensions ? (
          <div className="text-xs text-brand-success mt-1">
            Region: {Math.round(regionDimensions.width)}×
            {Math.round(regionDimensions.height)}
          </div>
        ) : showRegionInfo ? (
          <div className="text-xs text-text-muted mt-1">
            Select a region on the image
          </div>
        ) : null}
      </div>

      {additionalInfo}
    </div>
  );
};
