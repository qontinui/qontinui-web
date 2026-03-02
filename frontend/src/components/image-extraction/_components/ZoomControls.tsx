import React from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  onZoomIn,
  onZoomOut,
  onFitToView,
}) => (
  <div className="absolute top-4 right-4 flex gap-2 z-10">
    <button
      onClick={onZoomIn}
      className="p-2 bg-surface-raised rounded-lg hover:bg-surface-canvas transition-colors"
      title="Zoom In"
    >
      <ZoomIn className="w-4 h-4 text-white" />
    </button>
    <button
      onClick={onZoomOut}
      className="p-2 bg-surface-raised rounded-lg hover:bg-surface-canvas transition-colors"
      title="Zoom Out"
    >
      <ZoomOut className="w-4 h-4 text-white" />
    </button>
    <button
      onClick={onFitToView}
      className="p-2 bg-surface-raised rounded-lg hover:bg-surface-canvas transition-colors"
      title="Fit to View"
    >
      <Maximize2 className="w-4 h-4 text-white" />
    </button>
  </div>
);
