import React from "react";
import {
  Screenshot,
  ScreenshotRegion,
  ScreenshotLocation,
  SelectionMode,
} from "../../types/Screenshot";
import { useProgressiveImage } from "./ProgressiveImage";
import { useCanvasZoom } from "./_hooks/useCanvasZoom";
import { useCanvasInteraction } from "./_hooks/useCanvasInteraction";
import { useCanvasDrawing } from "./_hooks/useCanvasDrawing";
import CanvasToolbar from "./_components/CanvasToolbar";

interface ScreenshotCanvasProps {
  screenshot: Screenshot;
  selectionMode: SelectionMode;
  zoomMode: "fit" | "original";
  onRegionCreate: (region: ScreenshotRegion) => void;
  onLocationCreate: (location: ScreenshotLocation) => void;
  onRegionSelect: (region: ScreenshotRegion | null) => void;
  onLocationSelect: (location: ScreenshotLocation | null) => void;
}

const ScreenshotCanvas: React.FC<ScreenshotCanvasProps> = ({
  screenshot,
  selectionMode,
  zoomMode,
  onRegionCreate,
  onLocationCreate,
  onRegionSelect,
  onLocationSelect,
}) => {
  const {
    containerRef,
    effectiveZoom,
    offset,
    setOffset,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
  } = useCanvasZoom({
    zoomMode,
    screenshotWidth: screenshot.width,
    screenshotHeight: screenshot.height,
  });

  const screenshotVariants = (screenshot as { variants?: unknown }).variants as
    | {
        thumb?: string;
        medium?: string;
        large?: string;
        original: string;
      }
    | undefined;

  const { currentSrc, isLoading } = useProgressiveImage({
    imageUrl: screenshot.imageData,
    zoom: effectiveZoom,
    variants: screenshotVariants,
  });

  const {
    canvasRef,
    isDrawing,
    startPoint,
    currentRect,
    hoveredRegion,
    hoveredLocation,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    getCursor,
  } = useCanvasInteraction({
    screenshot,
    selectionMode,
    effectiveZoom,
    offset,
    setOffset,
    onRegionCreate,
    onLocationCreate,
    onRegionSelect,
    onLocationSelect,
  });

  useCanvasDrawing({
    canvasRef,
    screenshot,
    effectiveZoom,
    currentSrc,
    isLoading,
    isDrawing,
    startPoint,
    currentRect,
    hoveredRegion,
    hoveredLocation,
  });

  return (
    <div className="flex-1 flex flex-col bg-surface-raised min-h-0 relative">
      <CanvasToolbar
        selectionMode={selectionMode}
        effectiveZoom={effectiveZoom}
        screenshotWidth={screenshot.width}
        screenshotHeight={screenshot.height}
        isLoading={isLoading}
        screenshotVariants={screenshotVariants}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
      />

      <div ref={containerRef} className="flex-1 overflow-auto min-h-0">
        <div className="p-5">
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onContextMenu={(e) => e.preventDefault()}
              className="border border-border-default shadow-lg bg-white"
              style={{
                cursor: getCursor(),
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScreenshotCanvas;
