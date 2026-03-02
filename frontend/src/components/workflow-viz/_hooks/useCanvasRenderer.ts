import type { MonitorCanvasBounds } from "../useMonitorCanvas";
import { drawMonitorBackground, DEFAULT_THEME } from "../useMonitorCanvas";
import type { Monitor } from "@/lib/schemas/geometry";
import type {
  CanvasMode,
  VisibleFoundImage,
  ConfigImage,
  StateBound,
} from "../ActiveStatesCanvas-types";
import { useCanvasRedrawLoop } from "@/components/common/_hooks/useCanvasRedrawLoop";

interface UseCanvasRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  mode: CanvasMode;
  visibleFoundImages: VisibleFoundImage[];
  configImages: ConfigImage[];
  stateBounds: StateBound[];
  zoom: number;
  pan: { x: number; y: number };
  bounds: MonitorCanvasBounds;
  containerSize: { width: number; height: number };
  displayedMonitors: Monitor[];
  loadedImages: Map<string, HTMLImageElement>;
  monitorOffset: { x: number; y: number };
}

export function useCanvasRenderer(options: UseCanvasRendererOptions) {
  const {
    canvasRef,
    mode,
    visibleFoundImages,
    configImages,
    stateBounds,
    zoom,
    pan,
    bounds,
    containerSize,
    displayedMonitors,
    loadedImages,
    monitorOffset,
  } = options;

  // No containerRef -- this hook manages its own canvas sizing via
  // containerSize prop and device pixel ratio scaling.
  useCanvasRedrawLoop({
    canvasRef,
    draw(ctx, canvas) {
      // Skip rendering if container hasn't been measured yet
      if (containerSize.width === 0 || containerSize.height === 0) return;

      // Set canvas size to container size (NOT bounds!)
      // The pan/zoom transforms are calculated based on containerSize,
      // so the canvas buffer must match for correct rendering.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = containerSize.width * dpr;
      canvas.height = containerSize.height * dpr;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply transformations
      ctx.save();

      // Scale for high DPI displays
      ctx.scale(dpr, dpr);

      // Apply pan and zoom
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // Draw monitor areas with grey outside (using shared function with light theme)
      drawMonitorBackground(ctx, bounds, displayedMonitors, DEFAULT_THEME);

      // Draw images based on mode
      if (mode === "perception") {
        drawPerceptionMode(
          ctx,
          visibleFoundImages,
          loadedImages,
          monitorOffset
        );
      } else {
        drawConfigMode(
          ctx,
          stateBounds,
          configImages,
          loadedImages,
          monitorOffset
        );
      }

      ctx.restore();
    },
    deps: [
      mode,
      visibleFoundImages,
      configImages,
      stateBounds,
      zoom,
      pan,
      bounds,
      containerSize,
      displayedMonitors,
      loadedImages,
      monitorOffset,
      canvasRef,
    ],
  });
}

function drawPerceptionMode(
  ctx: CanvasRenderingContext2D,
  visibleFoundImages: VisibleFoundImage[],
  loadedImages: Map<string, HTMLImageElement>,
  monitorOffset: { x: number; y: number }
) {
  visibleFoundImages.forEach(({ imageId, recognition, color, imageLabel }) => {
    const loadedImg = loadedImages.get(imageId);
    if (!loadedImg) return;

    const x = (recognition.x ?? 0) + monitorOffset.x;
    const y = (recognition.y ?? 0) + monitorOffset.y;
    const w = recognition.width ?? loadedImg.naturalWidth;
    const h = recognition.height ?? loadedImg.naturalHeight;

    // Draw the image
    ctx.drawImage(loadedImg, x, y, w, h);

    // Draw colored border matching state color
    ctx.strokeStyle = color.border;
    ctx.lineWidth = 3;
    ctx.shadowColor = color.border;
    ctx.shadowBlur = 6;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    // Draw label with state color
    ctx.fillStyle = color.border;
    ctx.font = "bold 11px Arial";

    // Background for label
    const labelText = imageLabel;
    const labelWidth = ctx.measureText(labelText).width + 8;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(x, y - 18, labelWidth, 16);

    ctx.fillStyle = color.border;
    ctx.fillText(labelText, x + 4, y - 6);
  });
}

function drawConfigMode(
  ctx: CanvasRenderingContext2D,
  stateBounds: StateBound[],
  configImages: ConfigImage[],
  loadedImages: Map<string, HTMLImageElement>,
  monitorOffset: { x: number; y: number }
) {
  // Step 1: Draw state boundary backgrounds
  stateBounds.forEach(
    ({
      stateName,
      color,
      x: boundsX,
      y: boundsY,
      width: boundsW,
      height: boundsH,
      isHighlighted,
    }) => {
      // Add monitorOffset to translate from absolute screen coords to canvas coords
      const x = boundsX + monitorOffset.x;
      const y = boundsY + monitorOffset.y;

      // Draw background fill
      ctx.fillStyle = color.bg;
      ctx.fillRect(x, y, boundsW, boundsH);

      // Draw border
      ctx.strokeStyle = color.border;
      ctx.lineWidth = isHighlighted ? 3 : 2;
      ctx.globalAlpha = isHighlighted ? 1.0 : 0.6;
      if (isHighlighted) {
        ctx.shadowColor = color.border;
        ctx.shadowBlur = 8;
      }
      ctx.strokeRect(x, y, boundsW, boundsH);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;

      // Draw state name label in top-left corner
      ctx.font = isHighlighted ? "bold 13px Arial" : "bold 12px Arial";
      const labelText = stateName;
      const labelWidth = ctx.measureText(labelText).width + 12;
      const labelHeight = 20;

      // Label background
      ctx.fillStyle = color.border;
      ctx.globalAlpha = isHighlighted ? 1.0 : 0.85;
      ctx.fillRect(x, y, labelWidth, labelHeight);
      ctx.globalAlpha = 1.0;

      // Label text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(labelText, x + 6, y + 14);
    }
  );

  // Step 2: Draw images on top of state backgrounds
  configImages.forEach(
    ({
      imageId,
      color,
      imageLabel,
      x: imgX,
      y: imgY,
      width,
      height,
      isHighlighted,
    }) => {
      const loadedImg = loadedImages.get(imageId);
      if (!loadedImg) return;

      // Add monitorOffset to translate from absolute screen coords to canvas coords
      const x = imgX + monitorOffset.x;
      const y = imgY + monitorOffset.y;
      const w = width ?? loadedImg.naturalWidth;
      const h = height ?? loadedImg.naturalHeight;

      // Draw the image
      ctx.drawImage(loadedImg, x, y, w, h);

      // Draw colored border (thicker if highlighted)
      ctx.strokeStyle = color.border;
      ctx.lineWidth = isHighlighted ? 4 : 2;
      if (isHighlighted) {
        ctx.shadowColor = color.border;
        ctx.shadowBlur = 10;
      }
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;

      // Draw image label
      ctx.font = isHighlighted ? "bold 11px Arial" : "10px Arial";
      const labelText = imageLabel;
      const labelWidth = ctx.measureText(labelText).width + 8;
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(x, y - 16, labelWidth, 14);

      ctx.fillStyle = color.border;
      ctx.fillText(labelText, x + 4, y - 5);
    }
  );
}
