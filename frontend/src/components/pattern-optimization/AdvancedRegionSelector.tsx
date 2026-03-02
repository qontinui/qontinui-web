import React, { useRef, useEffect } from "react";
import { AdvancedRegionSelectorProps } from "./types";
import { useViewport } from "./_hooks/useViewport";
import { useImageLoader } from "./_hooks/useImageLoader";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { useRegionInteraction } from "./_hooks/useRegionInteraction";
import { RegionSelectorToolbar } from "./_components/RegionSelectorToolbar";

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

  const { zoom, pan, setZoom, setPan, resetView, handleWheel } = useViewport({
    controlledZoom,
    controlledPanX,
    controlledPanY,
    onViewportChange,
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
    console.log("[AdvancedRegionSelector] MOUNTED with props:", {
      isControlled:
        controlledZoom !== undefined && onViewportChange !== undefined,
      controlledZoom,
      screenshotUrl: screenshotUrl?.substring(0, 50) + "...",
    });
    return () => {
      console.log("[AdvancedRegionSelector] UNMOUNTED");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
