import React, { useRef, useEffect, useCallback } from "react";
import { createLogger } from "@/lib/logger";
import type { CompositeScreenshotCanvasProps } from "./types";
import { useImageLoader } from "./_hooks/useImageLoader";
import { useCanvasViewport } from "@/components/common/_hooks/useCanvasViewport";
import { useRegionInteraction } from "@/components/common/_hooks/useRegionInteraction";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { ZoomControls } from "@/components/common/_components/ZoomControls";
import { Maximize2 } from "lucide-react";
import { InfoOverlay } from "./_components/InfoOverlay";

export type { CompositeScreenshotDisplay } from "./types";

const log = createLogger("CompositeScreenshotCanvas");

export const CompositeScreenshotCanvas: React.FC<
  CompositeScreenshotCanvasProps
> = ({
  screenshots,
  region,
  onRegionChange,
  zoom: propZoom,
  panX: propPanX,
  panY: propPanY,
  onViewportChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.debug("MOUNTED");
    return () => {
      log.debug("UNMOUNTED");
    };
  }, []);

  const { loadedImages, compositeBounds } = useImageLoader(screenshots);

  const { zoom, pan, setZoom, setPan, fitToContent, handleWheel } =
    useCanvasViewport({
      canvasRef,
      containerRef,
      controlledZoom: propZoom,
      controlledPanX: propPanX,
      controlledPanY: propPanY,
      onViewportChange,
      contentSize: compositeBounds,
      autoFit: loadedImages.length > 0,
    });

  const {
    currentRegion,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  } = useRegionInteraction({
    region,
    onRegionChange,
    zoom,
    pan,
    setPan,
    canvasRef,
  });

  useCanvasRenderer({
    canvasRef,
    containerRef,
    loadedImages,
    compositeBounds,
    zoom,
    pan,
    currentRegion,
  });

  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(10, z * 1.2)),
    [setZoom]
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(0.1, z / 1.2)),
    [setZoom]
  );

  if (screenshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="text-center">
          <p className="text-sm">No screenshots captured</p>
          <p className="text-xs mt-1">Capture screens to view composite</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      />

      <ZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={fitToContent}
        resetIcon={Maximize2}
        resetTitle="Fit to View"
      />

      <InfoOverlay
        screenshotCount={screenshots.length}
        compositeBounds={compositeBounds}
        zoom={zoom}
        currentRegion={currentRegion}
      />
    </div>
  );
};
