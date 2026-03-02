import React from "react";
import type { ViewMode } from "../layout-preview-types";

interface CanvasHandlers {
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
}

interface PreviewCanvasAreaProps {
  viewMode: ViewMode;
  width: number;
  height: number;
  overlaySlider: number;
  onOverlaySliderChange: (value: number) => void;
  canvasRefBefore: React.RefObject<HTMLCanvasElement | null>;
  canvasRefAfter: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasHandlers: CanvasHandlers;
}

function PreviewCanvas({
  canvasRef,
  width,
  height,
  label,
  handlers,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  label: string;
  handlers: CanvasHandlers;
}) {
  return (
    <div className="preview-canvas-container">
      <div className="preview-label">{label}</div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="preview-canvas"
        onMouseDown={handlers.onMouseDown}
        onMouseMove={handlers.onMouseMove}
        onMouseUp={handlers.onMouseUp}
        onMouseLeave={handlers.onMouseLeave}
        onWheel={handlers.onWheel}
      />
    </div>
  );
}

export function PreviewCanvasArea({
  viewMode,
  width,
  height,
  overlaySlider,
  onOverlaySliderChange,
  canvasRefBefore,
  canvasRefAfter,
  overlayCanvasRef,
  canvasHandlers,
}: PreviewCanvasAreaProps) {
  const canvasWidth = viewMode === "side-by-side" ? width / 2 : width;

  return (
    <div className="preview-canvas-area">
      {viewMode === "side-by-side" && (
        <>
          <PreviewCanvas
            canvasRef={canvasRefBefore}
            width={canvasWidth}
            height={height}
            label="Before"
            handlers={canvasHandlers}
          />
          <PreviewCanvas
            canvasRef={canvasRefAfter}
            width={canvasWidth}
            height={height}
            label="After"
            handlers={canvasHandlers}
          />
        </>
      )}

      {viewMode === "overlay" && (
        <div className="preview-canvas-container overlay-container">
          <canvas
            ref={overlayCanvasRef}
            width={width}
            height={height}
            className="preview-canvas"
            onMouseDown={canvasHandlers.onMouseDown}
            onMouseMove={canvasHandlers.onMouseMove}
            onMouseUp={canvasHandlers.onMouseUp}
            onMouseLeave={canvasHandlers.onMouseLeave}
            onWheel={canvasHandlers.onWheel}
          />
          <div className="overlay-slider-container">
            <label htmlFor="lp-overlay-slider">Before</label>
            <input
              id="lp-overlay-slider"
              type="range"
              min="0"
              max="100"
              value={overlaySlider}
              onChange={(e) => onOverlaySliderChange(parseInt(e.target.value))}
              className="overlay-slider"
            />
            <span>After</span>
          </div>
        </div>
      )}

      {viewMode === "before-only" && (
        <PreviewCanvas
          canvasRef={canvasRefBefore}
          width={width}
          height={height}
          label="Before"
          handlers={canvasHandlers}
        />
      )}

      {viewMode === "after-only" && (
        <PreviewCanvas
          canvasRef={canvasRefAfter}
          width={width}
          height={height}
          label="After"
          handlers={canvasHandlers}
        />
      )}
    </div>
  );
}
