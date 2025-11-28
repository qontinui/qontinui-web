/**
 * Layout Preview Component
 *
 * Miniature canvas rendering for layout preview and comparison.
 * Features:
 * - Miniature canvas rendering
 * - Before/After side-by-side view
 * - Overlay mode with slider
 * - Zoom controls for preview
 * - Highlight changed nodes
 * - Statistics overlay
 * - Interactive (pan, zoom in preview)
 */

import React, { useState, useRef, useEffect } from "react";
import type { Workflow, Action } from "@/lib/action-schema/action-types";
import type { LayoutComparison } from "@/services/layout-statistics";

// ============================================================================
// Types
// ============================================================================

export interface LayoutPreviewProps {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  comparison: LayoutComparison;
  mode?: "side-by-side" | "overlay" | "before-only" | "after-only";
  width?: number;
  height?: number;
  showStats?: boolean;
  showChangedNodes?: boolean;
  interactive?: boolean;
}

type ViewMode = "side-by-side" | "overlay" | "before-only" | "after-only";

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

// ============================================================================
// Layout Preview Component
// ============================================================================

export function LayoutPreview({
  beforeWorkflow,
  afterWorkflow,
  comparison,
  mode = "side-by-side",
  width = 600,
  height = 400,
  showStats = true,
  showChangedNodes = true,
  interactive = true,
}: LayoutPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(mode);
  const [overlaySlider, setOverlaySlider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const canvasRefBefore = useRef<HTMLCanvasElement>(null);
  const canvasRefAfter = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate bounding boxes
  const beforeBBox = useMemo(
    () => calculateBoundingBox(beforeWorkflow.actions),
    [beforeWorkflow]
  );
  const afterBBox = useMemo(
    () => calculateBoundingBox(afterWorkflow.actions),
    [afterWorkflow]
  );

  // Identify changed nodes
  const changedNodeIds = useMemo(() => {
    const changed = new Set<string>();
    for (const action of beforeWorkflow.actions) {
      const afterAction = afterWorkflow.actions.find((a) => a.id === action.id);
      if (afterAction && action.position && afterAction.position) {
        const [x1, y1] = action.position;
        const [x2, y2] = afterAction.position;
        const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        if (distance > 1) {
          changed.add(action.id);
        }
      }
    }
    return changed;
  }, [beforeWorkflow, afterWorkflow]);

  // Draw workflows
  useEffect(() => {
    if (viewMode === "overlay") {
      drawOverlay();
    } else {
      if (viewMode !== "after-only") {
        drawWorkflow(
          canvasRefBefore.current,
          beforeWorkflow,
          beforeBBox,
          false
        );
      }
      if (viewMode !== "before-only") {
        drawWorkflow(canvasRefAfter.current, afterWorkflow, afterBBox, true);
      }
    }
  }, [
    viewMode,
    beforeWorkflow,
    afterWorkflow,
    zoom,
    pan,
    overlaySlider,
    showChangedNodes,
  ]);

  const drawWorkflow = (
    canvas: HTMLCanvasElement | null,
    workflow: Workflow,
    bbox: BoundingBox,
    highlightChanges: boolean
  ) => {
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale to fit
    const padding = 40;
    const scaleX = (canvas.width - padding * 2) / bbox.width;
    const scaleY = (canvas.height - padding * 2) / bbox.height;
    const scale = Math.min(scaleX, scaleY, 1) * zoom;

    // Center the workflow
    const offsetX =
      (canvas.width - bbox.width * scale) / 2 - bbox.minX * scale + pan.x;
    const offsetY =
      (canvas.height - bbox.height * scale) / 2 - bbox.minY * scale + pan.y;

    // Draw grid (optional)
    drawGrid(ctx, canvas.width, canvas.height, scale, offsetX, offsetY);

    // Draw connections
    drawConnections(ctx, workflow, scale, offsetX, offsetY);

    // Draw nodes
    for (const action of workflow.actions) {
      if (!action.position) continue;

      const isChanged =
        highlightChanges && showChangedNodes && changedNodeIds.has(action.id);
      drawNode(ctx, action, scale, offsetX, offsetY, isChanged);
    }
  };

  const drawOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use the larger bounding box
    const bbox = {
      minX: Math.min(beforeBBox.minX, afterBBox.minX),
      maxX: Math.max(beforeBBox.maxX, afterBBox.maxX),
      minY: Math.min(beforeBBox.minY, afterBBox.minY),
      maxY: Math.max(beforeBBox.maxY, afterBBox.maxY),
      width: Math.max(beforeBBox.width, afterBBox.width),
      height: Math.max(beforeBBox.height, afterBBox.height),
    };

    const padding = 40;
    const scaleX = (canvas.width - padding * 2) / bbox.width;
    const scaleY = (canvas.height - padding * 2) / bbox.height;
    const scale = Math.min(scaleX, scaleY, 1) * zoom;

    const offsetX =
      (canvas.width - bbox.width * scale) / 2 - bbox.minX * scale + pan.x;
    const offsetY =
      (canvas.height - bbox.height * scale) / 2 - bbox.minY * scale + pan.y;

    // Draw before (with opacity based on slider)
    ctx.save();
    ctx.globalAlpha = 1 - overlaySlider / 100;
    drawConnections(ctx, beforeWorkflow, scale, offsetX, offsetY);
    for (const action of beforeWorkflow.actions) {
      if (action.position) {
        drawNode(ctx, action, scale, offsetX, offsetY, false, "#3b82f6");
      }
    }
    ctx.restore();

    // Draw after (with opacity based on slider)
    ctx.save();
    ctx.globalAlpha = overlaySlider / 100;
    drawConnections(ctx, afterWorkflow, scale, offsetX, offsetY);
    for (const action of afterWorkflow.actions) {
      if (action.position) {
        drawNode(
          ctx,
          action,
          scale,
          offsetX,
          offsetY,
          showChangedNodes && changedNodeIds.has(action.id),
          "#10b981"
        );
      }
    }
    ctx.restore();
  };

  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number
  ) => {
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
  };

  const drawConnections = (
    ctx: CanvasRenderingContext2D,
    workflow: Workflow,
    scale: number,
    offsetX: number,
    offsetY: number
  ) => {
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 2 * scale;

    for (const [sourceId, connections] of Object.entries(
      workflow.connections
    )) {
      const source = workflow.actions.find((a) => a.id === sourceId);
      if (!source?.position) continue;

      const [x1, y1] = source.position;

      for (const outputType of [
        "main",
        "error",
        "success",
        "parallel",
      ] as const) {
        const outputs = connections[outputType];
        if (!outputs) continue;

        // Set color based on output type
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
  };

  const drawNode = (
    ctx: CanvasRenderingContext2D,
    action: Action,
    scale: number,
    offsetX: number,
    offsetY: number,
    isChanged: boolean,
    customColor?: string
  ) => {
    const [x, y] = action.position!;
    const nodeWidth = 180 * scale;
    const nodeHeight = 80 * scale;
    const nodeX = x * scale + offsetX;
    const nodeY = y * scale + offsetY;

    // Draw shadow if changed
    if (isChanged) {
      ctx.shadowColor = "rgba(251, 191, 36, 0.5)";
      ctx.shadowBlur = 10 * scale;
    }

    // Draw node background
    ctx.fillStyle = customColor || (isChanged ? "#fef3c7" : "#ffffff");
    ctx.strokeStyle = isChanged ? "#f59e0b" : "#d1d5db";
    ctx.lineWidth = isChanged ? 3 * scale : 2 * scale;

    roundRect(ctx, nodeX, nodeY, nodeWidth, nodeHeight, 8 * scale);
    ctx.fill();
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Draw node type badge
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

    // Draw text (if scale is large enough)
    if (scale > 0.3) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${12 * scale}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(action.type, nodeX + 12 * scale, nodeY + 18 * scale);

      // Draw name
      if (action.name && scale > 0.5) {
        ctx.fillStyle = "#374151";
        ctx.font = `${11 * scale}px sans-serif`;
        const maxWidth = nodeWidth - 16 * scale;
        const truncated = truncateText(ctx, action.name, maxWidth);
        ctx.fillText(truncated, nodeX + 8 * scale, nodeY + 45 * scale);
      }
    }
  };

  const getNodeColor = (type: string): string => {
    const colors: Record<string, string> = {
      CLICK: "#3b82f6",
      TYPE: "#10b981",
      WAIT: "#f59e0b",
      SCREENSHOT: "#8b5cf6",
      IF: "#ec4899",
      LOOP: "#f97316",
      TRY_CATCH: "#ef4444",
      DEFAULT: "#6b7280",
    };
    return colors[type] || colors.DEFAULT;
  };

  const roundRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) => {
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
  };

  const truncateText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string => {
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
  };

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive || !isPanning) return;
    setPan({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.max(0.1, Math.min(5, prev * delta)));
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(5, prev * 1.2));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.1, prev / 1.2));
  const handleZoomReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const canvasWidth = viewMode === "side-by-side" ? width / 2 : width;

  return (
    <div className="layout-preview">
      {/* View Mode Selector */}
      <div className="preview-controls">
        <div className="view-mode-selector">
          <button
            className={viewMode === "side-by-side" ? "active" : ""}
            onClick={() => setViewMode("side-by-side")}
          >
            Side by Side
          </button>
          <button
            className={viewMode === "overlay" ? "active" : ""}
            onClick={() => setViewMode("overlay")}
          >
            Overlay
          </button>
          <button
            className={viewMode === "before-only" ? "active" : ""}
            onClick={() => setViewMode("before-only")}
          >
            Before Only
          </button>
          <button
            className={viewMode === "after-only" ? "active" : ""}
            onClick={() => setViewMode("after-only")}
          >
            After Only
          </button>
        </div>

        {interactive && (
          <div className="zoom-controls">
            <button onClick={handleZoomOut} title="Zoom Out">
              -
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={handleZoomIn} title="Zoom In">
              +
            </button>
            <button onClick={handleZoomReset} title="Reset">
              ⟲
            </button>
          </div>
        )}
      </div>

      {/* Canvas Area */}
      <div className="preview-canvas-area">
        {viewMode === "side-by-side" && (
          <>
            <div className="preview-canvas-container">
              <div className="preview-label">Before</div>
              <canvas
                ref={canvasRefBefore}
                width={canvasWidth}
                height={height}
                className="preview-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              />
            </div>
            <div className="preview-canvas-container">
              <div className="preview-label">After</div>
              <canvas
                ref={canvasRefAfter}
                width={canvasWidth}
                height={height}
                className="preview-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              />
            </div>
          </>
        )}

        {viewMode === "overlay" && (
          <div className="preview-canvas-container overlay-container">
            <canvas
              ref={overlayCanvasRef}
              width={width}
              height={height}
              className="preview-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />
            <div className="overlay-slider-container">
              <label>Before</label>
              <input
                type="range"
                min="0"
                max="100"
                value={overlaySlider}
                onChange={(e) => setOverlaySlider(parseInt(e.target.value))}
                className="overlay-slider"
              />
              <label>After</label>
            </div>
          </div>
        )}

        {viewMode === "before-only" && (
          <div className="preview-canvas-container">
            <div className="preview-label">Before</div>
            <canvas
              ref={canvasRefBefore}
              width={width}
              height={height}
              className="preview-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />
          </div>
        )}

        {viewMode === "after-only" && (
          <div className="preview-canvas-container">
            <div className="preview-label">After</div>
            <canvas
              ref={canvasRefAfter}
              width={width}
              height={height}
              className="preview-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />
          </div>
        )}
      </div>

      {/* Statistics Overlay */}
      {showStats && (
        <div className="preview-stats">
          <div className="stat-item">
            <span className="stat-label">Nodes Moved:</span>
            <span className="stat-value">{changedNodeIds.size}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Improvement:</span>
            <span
              className={`stat-value ${comparison.isImprovement ? "positive" : "negative"}`}
            >
              {comparison.improvementScore > 0 ? "+" : ""}
              {Math.round(comparison.improvementScore)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateBoundingBox(actions: Action[]): BoundingBox {
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

function useMemo<T>(factory: () => T, deps: any[]): T {
  const ref = useRef<{ value: T; deps: any[] }>();

  if (!ref.current || !depsEqual(ref.current.deps, deps)) {
    ref.current = { value: factory(), deps };
  }

  return ref.current.value;
}

function depsEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
