import React, { useRef, useEffect } from "react";
import { createLogger } from "@/lib/logger";
import { AdvancedRegionSelectorProps } from "./types";
import { useCanvasViewport } from "@/components/common/_hooks/useCanvasViewport";
import { useImageLoader } from "./_hooks/useImageLoader";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { useRegionInteraction } from "@/components/common/_hooks/useRegionInteraction";
import { RegionSelectorToolbar } from "./_components/RegionSelectorToolbar";

const log = createLogger("AdvancedRegionSelector");

export const AdvancedRegionSelector: React.FC<AdvancedRegionSelectorProps> = ({
  screenshotId: _screenshotId,
  screenshotUrl,
  region,
  onRegionChange,
  zoom: controlledZoom,
  panX: controlledPanX,
  panY: controlledPanY,
  onViewportChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { zoom, pan, setZoom, setPan, resetView, handleWheel } =
    useCanvasViewport({
      canvasRef,
      controlledZoom,
      controlledPanX,
      controlledPanY,
      onViewportChange,
      maxZoom: 5,
    });

  const { imageData, imageDimensions } = useImageLoader(screenshotUrl);

  const { currentRegion, handleMouseDown, handleMouseMove, handleMouseUp } =
    useRegionInteraction({
      region,
      zoom,
      pan,
      setPan,
      onRegionChange,
      canvasRef,
    });

  useCanvasRenderer({
    canvasRef,
    containerRef,
    imageData,
    imageDimensions,
    zoom,
    pan,
    currentRegion,
  });

  useEffect(() => {
    log.debug("MOUNTED");
    return () => {
      log.debug("UNMOUNTED");
    };
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      <RegionSelectorToolbar
        zoom={zoom}
        onZoomIn={() => setZoom(Math.min(zoom * 1.2, 5))}
        onZoomOut={() => setZoom(Math.max(zoom * 0.8, 0.1))}
        onResetView={resetView}
        currentRegion={currentRegion}
      />

      <div ref={containerRef} className="flex-1 overflow-hidden">
        {imageData ? (
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full h-full"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted">
            Loading image...
          </div>
        )}
      </div>
    </div>
  );
};
