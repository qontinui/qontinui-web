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
import { useCanvasViewport } from "@/components/common/_hooks/useCanvasViewport";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { ZoomControls } from "@/components/common/_components/ZoomControls";
import { Maximize2 } from "lucide-react";
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
  const viewport = useCanvasViewport({
    canvasRef,
    containerRef,
    contentSize: canvasSize,
    autoFit: true,
    enableMousePan: true,
    maxZoom: 5,
  });

  // Canvas drawing (grid, regions, images, locations)
  useCanvasRenderer(
    canvasRef,
    containerRef,
    state,
    canvasSize,
    { zoom: viewport.zoom, pan: viewport.pan },
    showPositions,
    highlightElement,
    loadedImages
  );

  return (
    <div className="relative flex flex-col h-full">
      <ZoomControls
        zoom={viewport.zoom}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        onReset={viewport.fitToContent}
        resetIcon={Maximize2}
        resetTitle="Fit to View"
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
          style={{ cursor: viewport.isPanning ? "grabbing" : "grab" }}
          onMouseDown={viewport.handleMouseDown}
          onMouseMove={viewport.handleMouseMove}
          onMouseUp={viewport.handleMouseUp}
          onMouseLeave={viewport.handleMouseUp}
          onWheel={viewport.handleWheel}
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
