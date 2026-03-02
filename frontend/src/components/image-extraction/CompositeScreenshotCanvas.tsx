import React, { useRef, useEffect, useCallback } from "react";
import type { CompositeScreenshotCanvasProps } from "./types";
import { useImageLoader } from "./_hooks/useImageLoader";
import { useViewport } from "./_hooks/useViewport";
import { useRegionInteraction } from "./_hooks/useRegionInteraction";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { ZoomControls } from "./_components/ZoomControls";
import { InfoOverlay } from "./_components/InfoOverlay";

export type { CompositeScreenshotDisplay } from "./types";

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

  // Debug: mount/unmount tracking
  useEffect(() => {
    console.log("[CompositeCanvas] MOUNTED");
    return () => {
      console.log("[CompositeCanvas] UNMOUNTED");
    };
  }, []);

  const { loadedImages, compositeBounds, screenshotKey } =
    useImageLoader(screenshots);

  const { zoom, pan, setZoom, setPan, fitToView } = useViewport({
    propZoom,
    propPanX,
    propPanY,
    onViewportChange,
    compositeBounds,
    containerRef,
    screenshotKey,
    hasLoadedImages: loadedImages.length > 0,
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
      />

      <ZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToView={fitToView}
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
