import React from "react";
import type { ViewMode } from "../layout-preview-types";

interface PreviewControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  zoom: number;
  interactive: boolean;
  zoomControls: {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
  };
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "side-by-side", label: "Side by Side" },
  { value: "overlay", label: "Overlay" },
  { value: "before-only", label: "Before Only" },
  { value: "after-only", label: "After Only" },
];

export function PreviewControls({
  viewMode,
  onViewModeChange,
  zoom,
  interactive,
  zoomControls,
}: PreviewControlsProps) {
  return (
    <div className="preview-controls">
      <div className="view-mode-selector">
        {VIEW_MODES.map(({ value, label }) => (
          <button
            key={value}
            className={viewMode === value ? "active" : ""}
            onClick={() => onViewModeChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {interactive && (
        <div className="zoom-controls">
          <button onClick={zoomControls.onZoomOut} title="Zoom Out">
            -
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={zoomControls.onZoomIn} title="Zoom In">
            +
          </button>
          <button onClick={zoomControls.onReset} title="Reset">
            ⟲
          </button>
        </div>
      )}
    </div>
  );
}
