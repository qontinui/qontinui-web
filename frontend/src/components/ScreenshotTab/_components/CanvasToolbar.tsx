import React from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { SelectionMode } from "../../../types/Screenshot";

interface CanvasToolbarProps {
  selectionMode: SelectionMode;
  effectiveZoom: number;
  screenshotWidth: number;
  screenshotHeight: number;
  isLoading: boolean;
  screenshotVariants?: {
    thumb?: string;
    medium?: string;
    large?: string;
    original: string;
  };
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

const MODE_LABELS: Record<SelectionMode, string> = {
  view: "Left Click: Select annotation \u2022 Right Click: Pan",
  region: "Left Click: Draw region \u2022 Right Click: Pan",
  location: "Left Click: Place location \u2022 Right Click: Pan",
};

function getQualityLabel(effectiveZoom: number): string {
  if (effectiveZoom > 4) return "Original";
  if (effectiveZoom > 2) return "Large";
  return "Medium";
}

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  selectionMode,
  effectiveZoom,
  screenshotWidth,
  screenshotHeight,
  isLoading,
  screenshotVariants,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-border-subtle flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="bg-blue-600 text-white px-3 py-1 rounded text-sm">
          {MODE_LABELS[selectionMode]}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {screenshotVariants && (
          <div className="bg-surface-raised text-white px-3 py-1 rounded text-sm">
            {getQualityLabel(effectiveZoom)}
            {isLoading && " (Loading...)"}
          </div>
        )}

        <div className="bg-surface-raised text-white px-3 py-1 rounded text-sm">
          {Math.round(effectiveZoom * 100)}% | {screenshotWidth} x{" "}
          {screenshotHeight}px
        </div>
        <div className="flex gap-1 bg-white rounded-lg shadow border border-border-default p-1">
          <button
            onClick={onZoomIn}
            className="p-2 hover:bg-surface-raised rounded transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4 text-text-secondary" />
          </button>
          <button
            onClick={onZoomOut}
            className="p-2 hover:bg-surface-raised rounded transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4 text-text-secondary" />
          </button>
          <button
            onClick={onResetZoom}
            className="p-2 hover:bg-surface-raised rounded transition-colors"
            title="Reset Zoom"
          >
            <Maximize2 className="w-4 h-4 text-text-secondary" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CanvasToolbar;
