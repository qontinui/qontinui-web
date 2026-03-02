import React from "react";
import { Region } from "@/types/pattern-optimization";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface RegionSelectorToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  currentRegion: Region | null;
}

export const RegionSelectorToolbar: React.FC<RegionSelectorToolbarProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  currentRegion,
}) => {
  return (
    <div className="bg-white border-b p-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="text-sm text-text-muted px-2">
          <span className="font-medium">Left Click:</span> Select/Draw Region •{" "}
          <span className="font-medium">Right Click:</span> Pan
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onZoomIn}
          className="p-2 text-text-muted hover:bg-surface-raised rounded"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-sm text-text-muted font-mono min-w-[60px] text-center">
          {(zoom * 100).toFixed(0)}%
        </span>
        <button
          onClick={onZoomOut}
          className="p-2 text-text-muted hover:bg-surface-raised rounded"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={onResetView}
          className="p-2 text-text-muted hover:bg-surface-raised rounded"
          title="Reset view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {currentRegion && (
        <div className="text-xs text-text-muted">
          Position: ({Math.round(currentRegion.x)},{" "}
          {Math.round(currentRegion.y)}) | Size:{" "}
          {Math.round(currentRegion.width)} × {Math.round(currentRegion.height)}
        </div>
      )}
    </div>
  );
};
