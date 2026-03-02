import { useCallback, useEffect } from "react";
import { Region } from "@/types/pattern-optimization";
import { Point } from "../types";

interface UseCanvasRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  imageData: string | null;
  imageDimensions: { width: number; height: number } | null;
  zoom: number;
  pan: Point;
  currentRegion: Region | null;
}

export function useCanvasRenderer({
  canvasRef,
  containerRef,
  imageData,
  imageDimensions,
  zoom,
  pan,
  currentRegion,
}: UseCanvasRendererOptions) {
  const draw = useCallback(() => {
    if (!canvasRef.current || !imageData || !imageDimensions) {
      console.log(
        "[AdvancedRegionSelector] Draw skipped - missing requirements:",
        {
          hasCanvas: !!canvasRef.current,
          hasImageData: !!imageData,
          hasImageDimensions: !!imageDimensions,
        }
      );
      return;
    }

    console.log(
      "[AdvancedRegionSelector] Drawing canvas with imageData:",
      imageData.substring(0, 50) + "..."
    );

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      console.log(
        "[AdvancedRegionSelector] Image loaded in draw(), drawing to canvas"
      );
      const container = containerRef.current;
      if (!container) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      ctx.drawImage(img, 0, 0, img.width, img.height);

      if (currentRegion) {
        drawRegionOverlay(ctx, currentRegion, zoom);
      }

      ctx.restore();
    };

    img.onerror = (e) => {
      console.error(
        "[AdvancedRegionSelector] Failed to load image in draw():",
        e
      );
      console.error(
        "[AdvancedRegionSelector] Image src was:",
        imageData.substring(0, 100)
      );
    };

    img.src = imageData;
  }, [
    canvasRef,
    containerRef,
    imageData,
    imageDimensions,
    zoom,
    pan,
    currentRegion,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      draw();
    }, 0);
    return () => clearTimeout(timer);
  }, [draw]);

  useEffect(() => {
    const handleResize = () => {
      console.log("[AdvancedRegionSelector] Window resized, redrawing");
      draw();
    };

    window.addEventListener("resize", handleResize);

    if (imageData && imageDimensions) {
      console.log("[AdvancedRegionSelector] Initial draw trigger");
      const timer = setTimeout(() => draw(), 100);
      return () => {
        window.removeEventListener("resize", handleResize);
        clearTimeout(timer);
      };
    }

    return () => window.removeEventListener("resize", handleResize);
  }, [imageData, imageDimensions, draw]);
}

function drawRegionOverlay(
  ctx: CanvasRenderingContext2D,
  region: Region,
  zoom: number
) {
  ctx.fillStyle = "rgba(59, 130, 246, 0.5)";
  ctx.fillRect(region.x, region.y, region.width, region.height);

  ctx.strokeStyle = "#3B82F6";
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(region.x, region.y, region.width, region.height);

  const handleSize = 8 / zoom;
  ctx.fillStyle = "#3B82F6";

  // Corner handles
  ctx.fillRect(
    region.x - handleSize / 2,
    region.y - handleSize / 2,
    handleSize,
    handleSize
  );
  ctx.fillRect(
    region.x + region.width - handleSize / 2,
    region.y - handleSize / 2,
    handleSize,
    handleSize
  );
  ctx.fillRect(
    region.x - handleSize / 2,
    region.y + region.height - handleSize / 2,
    handleSize,
    handleSize
  );
  ctx.fillRect(
    region.x + region.width - handleSize / 2,
    region.y + region.height - handleSize / 2,
    handleSize,
    handleSize
  );

  // Edge handles
  ctx.fillRect(
    region.x + region.width / 2 - handleSize / 2,
    region.y - handleSize / 2,
    handleSize,
    handleSize
  );
  ctx.fillRect(
    region.x + region.width - handleSize / 2,
    region.y + region.height / 2 - handleSize / 2,
    handleSize,
    handleSize
  );
  ctx.fillRect(
    region.x + region.width / 2 - handleSize / 2,
    region.y + region.height - handleSize / 2,
    handleSize,
    handleSize
  );
  ctx.fillRect(
    region.x - handleSize / 2,
    region.y + region.height / 2 - handleSize / 2,
    handleSize,
    handleSize
  );

  // Dimensions text
  ctx.fillStyle = "#3B82F6";
  ctx.font = `${12 / zoom}px monospace`;
  const text = `${Math.round(region.width)} × ${Math.round(region.height)}`;
  const textWidth = ctx.measureText(text).width;
  ctx.fillText(
    text,
    region.x + region.width / 2 - textWidth / 2,
    region.y - 5 / zoom
  );
}
