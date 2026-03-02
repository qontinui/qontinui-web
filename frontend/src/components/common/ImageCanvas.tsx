import React, { useRef } from "react";
import { useCanvasViewport } from "./_hooks/useCanvasViewport";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { useBoxInteraction } from "./_hooks/useBoxInteraction";
import { ZoomControls } from "./_components/ZoomControls";

export type { BoundingBox, ImageCanvasProps } from "./_types/image-canvas";
import type { ImageCanvasProps } from "./_types/image-canvas";

export function ImageCanvas({
  imageUrl,
  boxes,
  selectedBoxId,
  onBoxesChange,
  onBoxSelect,
  minBoxSize = 5,
  maxZoom = 50,
  minZoom = 0.1,
  readonly = false,
  showControls = true,
  className = "",
}: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const viewport = useCanvasViewport({ canvasRef, minZoom, maxZoom });

  const interaction = useBoxInteraction({
    boxes,
    selectedBoxId,
    onBoxesChange,
    onBoxSelect,
    minBoxSize,
    readonly,
    zoom: viewport.zoom,
    pan: viewport.pan,
    setPan: viewport.setPan,
    screenToImage: viewport.screenToImage,
    imageRef,
  });

  useCanvasRenderer({
    canvasRef,
    containerRef,
    imageRef,
    imageUrl,
    boxes,
    selectedBoxId,
    tempBox: interaction.tempBox,
    zoom: viewport.zoom,
    pan: viewport.pan,
    imageToScreen: viewport.imageToScreen,
    readonly,
  });

  return (
    <div className={`relative flex flex-col ${className}`}>
      {showControls && (
        <ZoomControls
          zoom={viewport.zoom}
          onZoomIn={viewport.zoomIn}
          onZoomOut={viewport.zoomOut}
          onReset={viewport.resetView}
        />
      )}

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border"
      >
        <canvas
          ref={canvasRef}
          style={{ cursor: interaction.cursor }}
          onMouseDown={interaction.handleMouseDown}
          onMouseMove={interaction.handleMouseMove}
          onMouseUp={interaction.handleMouseUp}
          onMouseLeave={interaction.handleMouseUp}
          onWheel={viewport.handleWheel}
          onContextMenu={interaction.handleContextMenu}
          className="w-full h-full"
        />
      </div>

      {!readonly && (
        <div className="mt-2 text-sm text-muted-foreground text-center">
          Left-click: Draw/Edit • Right-click: Pan • Scroll: Zoom
        </div>
      )}
    </div>
  );
}
