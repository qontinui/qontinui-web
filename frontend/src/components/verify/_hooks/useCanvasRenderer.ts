import { useCallback, useEffect, type RefObject } from "react";
import type { State } from "@/contexts/automation-context/types";
import {
  drawGrid,
  drawRegions,
  drawStateImages,
  drawLocations,
} from "../_components/canvasDrawing";

interface CanvasSize {
  width: number;
  height: number;
}

interface ViewState {
  zoom: number;
  pan: { x: number; y: number };
}

/**
 * Handles all canvas drawing: grid, regions, state images, and locations.
 * Listens for resize events to keep the canvas sized to its container.
 */
export function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  state: State,
  canvasSize: CanvasSize,
  viewState: ViewState,
  showPositions: boolean,
  highlightElement: string | undefined,
  loadedImages: Map<string, HTMLImageElement>
) {
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply transformations
    ctx.save();
    ctx.translate(viewState.pan.x, viewState.pan.y);
    ctx.scale(viewState.zoom, viewState.zoom);

    // Draw canvas background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw grid
    drawGrid(ctx, canvasSize);

    // Draw canvas border
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw state elements in layer order
    drawRegions(ctx, state, showPositions, highlightElement);
    drawStateImages(ctx, state, loadedImages, showPositions, highlightElement);
    drawLocations(ctx, state, showPositions, highlightElement);

    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state,
    viewState.zoom,
    viewState.pan,
    showPositions,
    highlightElement,
    loadedImages,
    canvasSize,
  ]);

  // Redraw on changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Resize canvas to match container
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      redraw();
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [redraw, containerRef, canvasRef]);
}
