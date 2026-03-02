/**
 * Pure canvas drawing functions for the StateVisualizer.
 * These have no React dependencies and operate directly on a CanvasRenderingContext2D.
 */

import type { State } from "@/contexts/automation-context/types";

interface CanvasSize {
  width: number;
  height: number;
}

/** Draw a grid with labeled major lines. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvasSize: CanvasSize
) {
  const gridSize = 100;
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;

  for (let x = 0; x <= canvasSize.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasSize.height);
    ctx.stroke();
  }

  for (let y = 0; y <= canvasSize.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasSize.width, y);
    ctx.stroke();
  }

  // Labels for major grid lines
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px Arial";
  for (let x = 0; x <= canvasSize.width; x += 500) {
    ctx.fillText(`${x}`, x + 5, 15);
  }
  for (let y = 0; y <= canvasSize.height; y += 500) {
    ctx.fillText(`${y}`, 5, y + 15);
  }
}

/** Draw regions (background layer). */
export function drawRegions(
  ctx: CanvasRenderingContext2D,
  state: State,
  showPositions: boolean,
  highlightElement?: string
) {
  state.regions?.forEach((region) => {
    const isHighlighted = highlightElement === region.id;
    const alpha = isHighlighted ? 0.3 : 0.15;

    ctx.fillStyle = region.isSearchRegion
      ? `rgba(16, 185, 129, ${alpha})`
      : `rgba(34, 197, 94, ${alpha})`;
    ctx.fillRect(region.x, region.y, region.width, region.height);

    ctx.strokeStyle = isHighlighted
      ? "#3b82f6"
      : region.isSearchRegion
        ? "#10b981"
        : "#22c55e";
    ctx.lineWidth = isHighlighted ? 3 : 2;
    ctx.strokeRect(region.x, region.y, region.width, region.height);

    // Region label
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 11px Arial";
    ctx.fillText(region.name, region.x + 5, region.y + 15);

    // Position coordinates
    if (showPositions) {
      ctx.fillStyle = "#64748b";
      ctx.font = "10px Arial";
      ctx.fillText(
        `(${region.x}, ${region.y})`,
        region.x + 5,
        region.y + region.height - 5
      );
    }
  });
}

/** Draw StateImages with their patterns (middle layer). */
export function drawStateImages(
  ctx: CanvasRenderingContext2D,
  state: State,
  loadedImages: Map<string, HTMLImageElement>,
  showPositions: boolean,
  highlightElement?: string
) {
  state.stateImages?.forEach((stateImage) => {
    stateImage.patterns?.forEach((pattern) => {
      if (
        pattern.fixed &&
        pattern.offsetX !== undefined &&
        pattern.offsetY !== undefined
      ) {
        const isHighlighted = highlightElement === stateImage.id;
        const img = pattern.imageId ? loadedImages.get(pattern.imageId) : null;

        if (img) {
          drawLoadedImage(
            ctx,
            img,
            stateImage.name,
            pattern.offsetX,
            pattern.offsetY,
            isHighlighted,
            showPositions
          );
        } else {
          drawPlaceholder(
            ctx,
            stateImage.name,
            pattern.offsetX,
            pattern.offsetY,
            isHighlighted,
            showPositions
          );
        }
      }
    });
  });
}

function drawLoadedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  name: string,
  offsetX: number,
  offsetY: number,
  isHighlighted: boolean,
  showPositions: boolean
) {
  const maxWidth = 150;
  const maxHeight = 150;
  const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const width = img.width * scale;
  const height = img.height * scale;

  // Draw image
  ctx.save();
  if (isHighlighted) {
    ctx.shadowColor = "#3b82f6";
    ctx.shadowBlur = 10;
  }
  ctx.drawImage(img, offsetX, offsetY, width, height);
  ctx.restore();

  // Border
  ctx.strokeStyle = isHighlighted ? "#3b82f6" : "#64748b";
  ctx.lineWidth = isHighlighted ? 3 : 1;
  ctx.strokeRect(offsetX, offsetY, width, height);

  // Label background + text
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(offsetX, offsetY - 18, ctx.measureText(name).width + 10, 16);
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 11px Arial";
  ctx.fillText(name, offsetX + 5, offsetY - 5);

  // Position coordinates
  if (showPositions) {
    ctx.fillStyle = "#64748b";
    ctx.font = "10px Arial";
    ctx.fillText(
      `(${offsetX}, ${offsetY})`,
      offsetX + 5,
      offsetY + height + 12
    );
  }
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  name: string,
  offsetX: number,
  offsetY: number,
  isHighlighted: boolean,
  showPositions: boolean
) {
  const width = 100;
  const height = 100;

  ctx.fillStyle = isHighlighted
    ? "rgba(59, 130, 246, 0.1)"
    : "rgba(148, 163, 184, 0.1)";
  ctx.fillRect(offsetX, offsetY, width, height);

  ctx.strokeStyle = isHighlighted ? "#3b82f6" : "#94a3b8";
  ctx.lineWidth = isHighlighted ? 3 : 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(offsetX, offsetY, width, height);
  ctx.setLineDash([]);

  // Placeholder text
  ctx.fillStyle = "#64748b";
  ctx.font = "11px Arial";
  ctx.textAlign = "center";
  ctx.fillText(name, offsetX + width / 2, offsetY + height / 2);
  ctx.textAlign = "left";

  // Position coordinates
  if (showPositions) {
    ctx.fillStyle = "#64748b";
    ctx.font = "10px Arial";
    ctx.fillText(
      `(${offsetX}, ${offsetY})`,
      offsetX + 5,
      offsetY + height + 12
    );
  }
}

/** Draw locations as colored dots (top layer). */
export function drawLocations(
  ctx: CanvasRenderingContext2D,
  state: State,
  showPositions: boolean,
  highlightElement?: string
) {
  state.locations?.forEach((location) => {
    const isHighlighted = highlightElement === location.id;
    const color = location.fixed
      ? "#dc2626"
      : location.anchor
        ? "#8b5cf6"
        : "#f59e0b";
    const radius = isHighlighted ? 8 : 6;

    // Location point
    ctx.fillStyle = color;
    ctx.globalAlpha = isHighlighted ? 1.0 : 0.8;
    ctx.beginPath();
    ctx.arc(location.x, location.y, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Border
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = isHighlighted ? 3 : 2;
    ctx.stroke();

    // Label
    if (isHighlighted || showPositions) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(
        location.x + 10,
        location.y - 8,
        ctx.measureText(location.name).width + 10,
        16
      );
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 10px Arial";
      ctx.fillText(location.name, location.x + 15, location.y + 4);

      // Coordinates
      if (showPositions) {
        ctx.fillStyle = "#64748b";
        ctx.font = "9px Arial";
        ctx.fillText(
          `(${location.x}, ${location.y})`,
          location.x + 15,
          location.y + 14
        );
      }
    }
  });
}
