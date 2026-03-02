import { Region } from "@/types/pattern-optimization";
import { Point } from "../types";
import { useCanvasRedrawLoop } from "@/components/common/_hooks/useCanvasRedrawLoop";

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
  useCanvasRedrawLoop({
    canvasRef,
    containerRef,
    draw(ctx, canvas) {
      if (!imageData || !imageDimensions) return;

      const img = new Image();
      img.onload = () => {
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

      img.src = imageData;
    },
    deps: [
      canvasRef,
      containerRef,
      imageData,
      imageDimensions,
      zoom,
      pan,
      currentRegion,
    ],
  });
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
  const text = `${Math.round(region.width)} x ${Math.round(region.height)}`;
  const textWidth = ctx.measureText(text).width;
  ctx.fillText(
    text,
    region.x + region.width / 2 - textWidth / 2,
    region.y - 5 / zoom
  );
}
