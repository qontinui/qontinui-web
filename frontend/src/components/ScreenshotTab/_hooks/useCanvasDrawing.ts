import { useEffect, useCallback, RefObject } from "react";
import {
  Screenshot,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../../types/Screenshot";

interface UseCanvasDrawingOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  screenshot: Screenshot;
  effectiveZoom: number;
  currentSrc: string;
  isLoading: boolean;
  isDrawing: boolean;
  startPoint: { x: number; y: number } | null;
  currentRect: DOMRect | null;
  hoveredRegion: ScreenshotRegion | null;
  hoveredLocation: ScreenshotLocation | null;
}

function drawRegions(
  ctx: CanvasRenderingContext2D,
  regions: ScreenshotRegion[],
  hoveredRegion: ScreenshotRegion | null,
  effectiveScale: number
) {
  regions.forEach((region) => {
    const isHovered = hoveredRegion?.id === region.id;
    ctx.strokeStyle =
      region.type === "StateRegion"
        ? isHovered
          ? "#10b981"
          : "rgba(16, 185, 129, 0.7)"
        : isHovered
          ? "#eab308"
          : "rgba(234, 179, 8, 0.7)";
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.strokeRect(
      region.bounds.x * effectiveScale,
      region.bounds.y * effectiveScale,
      region.bounds.width * effectiveScale,
      region.bounds.height * effectiveScale
    );

    ctx.font = "12px sans-serif";
    const textMetrics = ctx.measureText(region.name);
    const textHeight = 16;
    const padding = 4;

    ctx.fillStyle =
      region.type === "StateRegion"
        ? "rgba(16, 185, 129, 0.9)"
        : "rgba(234, 179, 8, 0.9)";
    ctx.fillRect(
      region.bounds.x * effectiveScale,
      region.bounds.y * effectiveScale - textHeight - padding,
      textMetrics.width + padding * 2,
      textHeight
    );

    ctx.fillStyle = "white";
    ctx.fillText(
      region.name,
      region.bounds.x * effectiveScale + padding,
      region.bounds.y * effectiveScale - padding - 2
    );
  });
}

function drawLocations(
  ctx: CanvasRenderingContext2D,
  locations: ScreenshotLocation[],
  hoveredLocation: ScreenshotLocation | null,
  effectiveScale: number
) {
  locations.forEach((location) => {
    const isHovered = hoveredLocation?.id === location.id;
    const x = location.x * effectiveScale;
    const y = location.y * effectiveScale;
    const size = isHovered ? 15 : 10;

    ctx.strokeStyle = isHovered ? "#ef4444" : "rgba(239, 68, 68, 0.8)";
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
    ctx.fillRect(x + 15, y - 10, ctx.measureText(location.name).width + 8, 16);
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.fillText(location.name, x + 19, y + 2);
  });
}

function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  currentRect: DOMRect,
  effectiveScale: number
) {
  ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(
    currentRect.x * effectiveScale,
    currentRect.y * effectiveScale,
    currentRect.width * effectiveScale,
    currentRect.height * effectiveScale
  );
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
  const dimText = `${Math.round(currentRect.width)} x ${Math.round(currentRect.height)}`;
  const textWidth = ctx.measureText(dimText).width;
  ctx.fillRect(
    currentRect.x * effectiveScale +
      currentRect.width * effectiveScale -
      textWidth -
      8,
    currentRect.y * effectiveScale + currentRect.height * effectiveScale - 20,
    textWidth + 8,
    16
  );
  ctx.fillStyle = "white";
  ctx.fillText(
    dimText,
    currentRect.x * effectiveScale +
      currentRect.width * effectiveScale -
      textWidth -
      4,
    currentRect.y * effectiveScale + currentRect.height * effectiveScale - 6
  );
}

export function useCanvasDrawing({
  canvasRef,
  screenshot,
  effectiveZoom,
  currentSrc,
  isLoading,
  isDrawing,
  startPoint,
  currentRect,
  hoveredRegion,
  hoveredLocation,
}: UseCanvasDrawingOptions) {
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = screenshot.width * effectiveZoom;
    canvas.height = screenshot.height * effectiveZoom;

    const img = new window.Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (isLoading) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(10, 10, 120, 30);
        ctx.fillStyle = "white";
        ctx.font = "12px sans-serif";
        ctx.fillText("Loading higher quality...", 20, 30);
      }

      drawRegions(ctx, screenshot.regions, hoveredRegion, effectiveZoom);
      drawLocations(ctx, screenshot.locations, hoveredLocation, effectiveZoom);

      if (isDrawing && startPoint && currentRect) {
        drawSelectionRect(ctx, currentRect, effectiveZoom);
      }
    };
    img.src = currentSrc;
  }, [
    canvasRef,
    screenshot,
    effectiveZoom,
    currentRect,
    hoveredRegion,
    hoveredLocation,
    currentSrc,
    isLoading,
    isDrawing,
    startPoint,
  ]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);
}
