import React from "react";
import { Slider } from "../../ui/slider";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";

interface MaskEditorControlsProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export const MaskEditorControls: React.FC<MaskEditorControlsProps> = ({
  brushSize,
  onBrushSizeChange,
  opacity,
  onOpacityChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}) => {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div className="flex-1">
        <p className="text-sm text-text-muted">Brush Size: {brushSize}px</p>
        <Slider
          value={[brushSize]}
          onValueChange={(v) => onBrushSizeChange(v[0] ?? 5)}
          min={1}
          max={50}
          step={1}
          className="mt-1"
        />
      </div>
      <div className="flex-1">
        <p className="text-sm text-text-muted">
          Opacity: {Math.round(opacity * 100)}%
        </p>
        <Slider
          value={[opacity * 100]}
          onValueChange={(v) => onOpacityChange(v[0]! / 100)}
          min={0}
          max={100}
          step={5}
          className="mt-1"
        />
      </div>
      <div className="flex gap-1">
        <button
          onClick={onZoomOut}
          className="p-2 rounded hover:bg-surface-raised/80"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={onResetZoom}
          className="p-2 rounded hover:bg-surface-raised/80"
          title="Reset Zoom"
        >
          <Maximize className="w-4 h-4" />
        </button>
        <button
          onClick={onZoomIn}
          className="p-2 rounded hover:bg-surface-raised/80"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-sm text-text-muted ml-2">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
};
