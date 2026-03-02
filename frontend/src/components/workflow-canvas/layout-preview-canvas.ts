import type { Workflow, Action } from "@/lib/action-schema/action-types";
import type { BoundingBox } from "./layout-preview-types";

export function calculateBoundingBox(actions: Action[]): BoundingBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const action of actions) {
    if (!action.position) continue;
    const [x, y] = action.position;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + 180);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + 80);
  }

  if (minX === Infinity) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number
) {
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 0.5;

  const gridSize = 50 * scale;

  for (let x = offsetX % gridSize; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = offsetY % gridSize; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

export function drawConnections(
  ctx: CanvasRenderingContext2D,
  workflow: Workflow,
  scale: number,
  offsetX: number,
  offsetY: number
) {
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 2 * scale;

  for (const [sourceId, connections] of Object.entries(workflow.connections)) {
    const source = workflow.actions.find((a) => a.id === sourceId);
    if (!source?.position) continue;

    const [x1, y1] = source.position;

    for (const outputType of [
      "main",
      "error",
      "success",
      "parallel",
    ] as const) {
      const outputs = connections[outputType as keyof typeof connections];
      if (!outputs) continue;

      switch (outputType) {
        case "error":
          ctx.strokeStyle = "#ef4444";
          break;
        case "success":
          ctx.strokeStyle = "#10b981";
          break;
        case "parallel":
          ctx.strokeStyle = "#8b5cf6";
          break;
        default:
          ctx.strokeStyle = "#9ca3af";
      }

      for (const conns of outputs) {
        for (const conn of conns) {
          const target = workflow.actions.find((a) => a.id === conn.action);
          if (!target?.position) continue;

          const [x2, y2] = target.position;

          ctx.beginPath();
          ctx.moveTo(
            x1 * scale + offsetX + 90 * scale,
            y1 * scale + offsetY + 40 * scale
          );
          ctx.lineTo(
            x2 * scale + offsetX + 90 * scale,
            y2 * scale + offsetY + 40 * scale
          );
          ctx.stroke();
        }
      }
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const metrics = ctx.measureText(text);
  if (metrics.width <= maxWidth) return text;

  let truncated = text;
  while (
    ctx.measureText(truncated + "...").width > maxWidth &&
    truncated.length > 0
  ) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

function getNodeColor(type: string): string {
  const colors: Record<string, string> = {
    CLICK: "#3b82f6",
    TYPE: "#10b981",
    SCREENSHOT: "#8b5cf6",
    IF: "#ec4899",
    LOOP: "#f97316",
    TRY_CATCH: "#ef4444",
    DEFAULT: "#6b7280",
  };
  return (colors[type] || colors.DEFAULT) as string;
}

export function drawNode(
  ctx: CanvasRenderingContext2D,
  action: Action,
  scale: number,
  offsetX: number,
  offsetY: number,
  isChanged: boolean,
  customColor?: string
) {
  const [x, y] = action.position!;
  const nodeWidth = 180 * scale;
  const nodeHeight = 80 * scale;
  const nodeX = x * scale + offsetX;
  const nodeY = y * scale + offsetY;

  if (isChanged) {
    ctx.shadowColor = "rgba(251, 191, 36, 0.5)";
    ctx.shadowBlur = 10 * scale;
  }

  ctx.fillStyle = customColor || (isChanged ? "#fef3c7" : "#ffffff");
  ctx.strokeStyle = isChanged ? "#f59e0b" : "#d1d5db";
  ctx.lineWidth = isChanged ? 3 * scale : 2 * scale;

  roundRect(ctx, nodeX, nodeY, nodeWidth, nodeHeight, 8 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;

  ctx.fillStyle = getNodeColor(action.type);
  roundRect(
    ctx,
    nodeX + 8 * scale,
    nodeY + 8 * scale,
    60 * scale,
    20 * scale,
    4 * scale
  );
  ctx.fill();

  if (scale > 0.3) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${12 * scale}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(action.type, nodeX + 12 * scale, nodeY + 18 * scale);

    if (action.name && scale > 0.5) {
      ctx.fillStyle = "#374151";
      ctx.font = `${11 * scale}px sans-serif`;
      const maxWidth = nodeWidth - 16 * scale;
      const truncated = truncateText(ctx, action.name, maxWidth);
      ctx.fillText(truncated, nodeX + 8 * scale, nodeY + 45 * scale);
    }
  }
}
