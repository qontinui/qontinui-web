"use client";

import React from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface CanvasToolbarProps {
  zoom: number;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  resetView: () => void;
}

export function CanvasToolbar({
  zoom,
  setZoom,
  resetView,
}: CanvasToolbarProps) {
  return (
    <div className="bg-white border-b p-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="text-sm text-text-muted px-2">
          <span className="font-medium">Left Click:</span> Select Segment •{" "}
          <span className="font-medium">Right Click:</span> Pan
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setZoom(Math.min(zoom * 1.2, 5))}
          className="p-2 text-text-muted hover:bg-surface-canvas rounded"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-sm text-text-muted font-mono min-w-[60px] text-center">
          {(zoom * 100).toFixed(0)}%
        </span>
        <button
          onClick={() => setZoom(Math.max(zoom * 0.8, 0.1))}
          className="p-2 text-text-muted hover:bg-surface-canvas rounded"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          className="p-2 text-text-muted hover:bg-surface-canvas rounded"
          title="Reset view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
