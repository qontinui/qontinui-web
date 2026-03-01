import { useState } from "react";
import type { CanvasViewportState, Point } from "../semantic-analysis-types";

export function useCanvasViewport(): CanvasViewportState {
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });

  const zoomIn = () => setZoom(Math.min(zoom * 1.2, 5));
  const zoomOut = () => setZoom(Math.max(zoom * 0.8, 0.5));
  const resetView = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return {
    zoom,
    panOffset,
    isDragging,
    dragStart,
    setZoom,
    setPanOffset,
    setIsDragging,
    setDragStart,
    zoomIn,
    zoomOut,
    resetView,
  };
}
