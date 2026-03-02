import { useCallback, useEffect } from "react";
import { Region } from "@/types/pattern-optimization";
import type { LoadedImage, CompositeBounds } from "../types";
import { getHandlePositions } from "../utils";

interface UseCanvasRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  loadedImages: LoadedImage[];
  compositeBounds: CompositeBounds | null;
  zoom: number;
  pan: { x: number; y: number };
  currentRegion: Region | null;
}

export function useCanvasRenderer({
  canvasRef,
  containerRef,
  loadedImages,
  compositeBounds,
  zoom,
  pan,
  currentRegion,
}: UseCanvasRendererOptions) {
  const draw = useCallback(() => {
    if (!canvasRef.current || !compositeBounds || loadedImages.length === 0) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Clear canvas with background
    ctx.fillStyle = "#1a1a1b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply transformations
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw each screenshot at its position (normalized to start at 0,0)
    for (const { screenshot, image } of loadedImages) {
      const normalizedX = screenshot.monitor.x - compositeBounds.minX;
      const normalizedY = screenshot.monitor.y - compositeBounds.minY;

      ctx.drawImage(image, normalizedX, normalizedY, image.width, image.height);

      // Draw subtle border around each monitor
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(normalizedX, normalizedY, image.width, image.height);
    }

    // Draw region if exists
    if (currentRegion) {
      ctx.fillStyle = "rgba(0, 217, 255, 0.3)";
      ctx.fillRect(
        currentRegion.x,
        currentRegion.y,
        currentRegion.width,
        currentRegion.height
      );

      ctx.strokeStyle = "#00D9FF";
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(
        currentRegion.x,
        currentRegion.y,
        currentRegion.width,
        currentRegion.height
      );

      // Draw resize handles
      const handleSize = 8 / zoom;
      ctx.fillStyle = "#00D9FF";

      const handles = getHandlePositions(currentRegion);

      for (const handle of handles) {
        ctx.fillRect(
          handle.x - handleSize / 2,
          handle.y - handleSize / 2,
          handleSize,
          handleSize
        );
      }
    }

    ctx.restore();

    // Draw monitor labels
    ctx.font = "12px system-ui";
    for (const { screenshot } of loadedImages) {
      const normalizedX = screenshot.monitor.x - compositeBounds.minX;
      const normalizedY = screenshot.monitor.y - compositeBounds.minY;

      const screenX = normalizedX * zoom + pan.x;
      const screenY = normalizedY * zoom + pan.y;

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(screenX + 5, screenY + 5, 85, 20);
      ctx.fillStyle = "#00D9FF";
      ctx.fillText(
        `Monitor ${screenshot.monitor.index}`,
        screenX + 10,
        screenY + 19
      );
    }
  }, [
    loadedImages,
    compositeBounds,
    zoom,
    pan,
    currentRegion,
    canvasRef,
    containerRef,
  ]);

  // Redraw on state changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      draw();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);
}
