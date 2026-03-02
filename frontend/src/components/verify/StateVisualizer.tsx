/**
 * StateVisualizer Component
 *
 * Renders a single state with its elements (StateImages, regions, locations)
 * positioned at their fixed screen coordinates.
 *
 * Features:
 * - 1920x1080 canvas (standard screen size)
 * - Displays StateImages at fixed positions
 * - Shows regions and locations
 * - Optional position coordinate display
 * - Element highlighting
 * - Pan and zoom controls
 */

import React, { useRef } from "react";
import type { State } from "@/contexts/automation-context/types";
import { useImageLoader } from "./_hooks/useImageLoader";
import { useCanvasView } from "./_hooks/useCanvasView";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { ZoomControls } from "./_components/ZoomControls";
import { CanvasInfo } from "./_components/CanvasInfo";

export interface StateVisualizerProps {
  state: State;
  canvasSize: { width: number; height: number };
  showPositions?: boolean;
  highlightElement?: string;
}

export function StateVisualizer({
  state,
  canvasSize,
  showPositions = false,
  highlightElement,
}: StateVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load pattern images
  const loadedImages = useImageLoader(state);

  // Pan/zoom state and mouse interaction
  const { viewState, mouseHandlers, zoomControls } = useCanvasView(
    canvasSize,
    containerRef,
    canvasRef
  );

  // Canvas drawing (grid, regions, images, locations)
  useCanvasRenderer(
    canvasRef,
    containerRef,
    state,
    canvasSize,
    viewState,
    showPositions,
    highlightElement,
    loadedImages
  );

  return (
    <div className="relative flex flex-col h-full">
      <ZoomControls
        zoom={viewState.zoom}
        onZoomIn={zoomControls.handleZoomIn}
        onZoomOut={zoomControls.handleZoomOut}
        onResetView={zoomControls.handleResetView}
      />

      <CanvasInfo
        stateName={state.name}
        width={canvasSize.width}
        height={canvasSize.height}
      />

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border bg-white"
      >
        <canvas
          ref={canvasRef}
          style={{ cursor: viewState.isPanning ? "grabbing" : "grab" }}
          onMouseDown={mouseHandlers.handleMouseDown}
          onMouseMove={mouseHandlers.handleMouseMove}
          onMouseUp={mouseHandlers.handleMouseUp}
          onMouseLeave={mouseHandlers.handleMouseUp}
          onWheel={mouseHandlers.handleWheel}
          className="w-full h-full"
        />
      </div>

      {/* Instructions */}
      <div className="mt-2 text-sm text-muted-foreground text-center">
        Drag to pan • Scroll to zoom • Click elements in metadata panel to
        highlight
      </div>
    </div>
  );
}
