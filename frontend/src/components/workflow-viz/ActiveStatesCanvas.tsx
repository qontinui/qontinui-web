/**
 * Active States Canvas
 *
 * Displays multiple active states on a canvas with:
 * - Faded background rectangles covering state bounds
 * - Most recent state in front (z-index)
 * - State elements positioned at their fixed locations
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { State } from "@/contexts/automation-context/types";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Move, Layers } from "lucide-react";

interface ActiveStatesCanvasProps {
  states: State[];
  highlightStateId?: string;
  className?: string;
}

// Canvas dimensions
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

// Colors for state bounds (faded backgrounds)
const STATE_COLORS = [
  "rgba(59, 130, 246, 0.15)", // blue
  "rgba(34, 197, 94, 0.15)", // green
  "rgba(245, 158, 11, 0.15)", // amber
  "rgba(236, 72, 153, 0.15)", // pink
  "rgba(139, 92, 246, 0.15)", // purple
  "rgba(239, 68, 68, 0.15)", // red
];

interface StateBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ActiveStatesCanvas({
  states,
  highlightStateId,
  className = "",
}: ActiveStatesCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // View state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );

  // Calculate bounds for a state based on its outermost elements
  const calculateStateBounds = useCallback((state: State): StateBounds => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Check StateImages (patterns)
    state.stateImages?.forEach((img) => {
      img.patterns?.forEach((pattern) => {
        if (
          pattern.fixed &&
          pattern.offsetX !== undefined &&
          pattern.offsetY !== undefined
        ) {
          const x = pattern.offsetX;
          const y = pattern.offsetY;
          const w = 100; // Default width
          const h = 100; // Default height

          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
        }
      });
    });

    // Check StateRegions
    state.regions?.forEach((region) => {
      minX = Math.min(minX, region.x);
      minY = Math.min(minY, region.y);
      maxX = Math.max(maxX, region.x + region.width);
      maxY = Math.max(maxY, region.y + region.height);
    });

    // Check StateLocations
    state.locations?.forEach((location) => {
      minX = Math.min(minX, location.x);
      minY = Math.min(minY, location.y);
      maxX = Math.max(maxX, location.x);
      maxY = Math.max(maxY, location.y);
    });

    // Add padding
    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // If no elements found, return a default size
    if (minX === Infinity) {
      return { x: 0, y: 0, width: 200, height: 200 };
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, []);

  // Auto-fit on mount
  useEffect(() => {
    if (!containerRef.current || states.length === 0) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;

    const zoomX = (containerWidth - 40) / CANVAS_WIDTH;
    const zoomY = (containerHeight - 40) / CANVAS_HEIGHT;
    const fitZoom = Math.min(zoomX, zoomY, 1);

    setZoom(fitZoom);
    setPan({
      x: (containerWidth - CANVAS_WIDTH * fitZoom) / 2,
      y: (containerHeight - CANVAS_WIDTH * fitZoom) / 2,
    });
  }, [states.length]);

  // Redraw canvas
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
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    drawGrid(ctx);

    // Draw states (oldest to newest, so newest is on top)
    states.forEach((state, index) => {
      const bounds = calculateStateBounds(state);
      const color = STATE_COLORS[index % STATE_COLORS.length];
      const isHighlighted = state.id === highlightStateId;

      // Draw state bounds rectangle
      ctx.fillStyle = color;
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

      // Draw border
      ctx.strokeStyle = isHighlighted ? "#3b82f6" : "rgba(100, 116, 139, 0.3)";
      ctx.lineWidth = isHighlighted ? 3 : 2;
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

      // Draw state name label
      ctx.fillStyle = isHighlighted ? "#3b82f6" : "#64748b";
      ctx.font = isHighlighted ? "bold 14px Arial" : "bold 12px Arial";
      ctx.fillText(state.name, bounds.x + 10, bounds.y + 25);

      // Draw z-index indicator
      ctx.font = "10px Arial";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(
        `z: ${index + 1}`,
        bounds.x + 10,
        bounds.y + bounds.height - 10
      );

      // Draw state elements
      drawStateElements(ctx, state, isHighlighted);
    });

    ctx.restore();
  }, [states, zoom, pan, highlightStateId, calculateStateBounds]);

  // Draw grid
  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    const gridSize = 100;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;

    for (let x = 0; x <= CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }

    for (let y = 0; y <= CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }
  };

  // Draw state elements
  const drawStateElements = (
    ctx: CanvasRenderingContext2D,
    state: State,
    highlighted: boolean
  ) => {
    const alpha = highlighted ? 1.0 : 0.6;

    // Draw regions
    state.regions?.forEach((region) => {
      ctx.fillStyle = region.isSearchRegion
        ? `rgba(16, 185, 129, ${alpha * 0.2})`
        : `rgba(34, 197, 94, ${alpha * 0.2})`;
      ctx.fillRect(region.x, region.y, region.width, region.height);

      ctx.strokeStyle = region.isSearchRegion ? "#10b981" : "#22c55e";
      ctx.lineWidth = 1;
      ctx.strokeRect(region.x, region.y, region.width, region.height);
    });

    // Draw locations
    state.locations?.forEach((location) => {
      const color = location.fixed
        ? "#dc2626"
        : location.anchor
          ? "#8b5cf6"
          : "#f59e0b";
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(location.x, location.y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  // Redraw on changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && dragStart) {
      setPan({
        x: pan.x + (e.clientX - dragStart.x),
        y: pan.y + (e.clientY - dragStart.y),
      });
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDragStart(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(0.1, zoom * delta), 5);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setPan({
        x: mouseX - ((mouseX - pan.x) * newZoom) / zoom,
        y: mouseY - ((mouseY - pan.y) * newZoom) / zoom,
      });
    }

    setZoom(newZoom);
  };

  // Resize canvas
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
  }, [redraw]);

  // Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.2, 5));
  const handleZoomOut = () => setZoom((z) => Math.max(z * 0.833, 0.1));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className={`relative flex flex-col h-full ${className}`}>
      {/* Zoom Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-background/80 backdrop-blur-sm rounded-lg p-2 shadow-lg">
        <Button
          size="sm"
          variant="outline"
          onClick={handleZoomIn}
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleResetView}
          title="Reset View"
        >
          <Move className="h-4 w-4" />
        </Button>
        <div className="text-xs text-center text-muted-foreground px-2">
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* Info Badge */}
      {states.length > 0 && (
        <div className="absolute top-4 left-4 z-10 bg-background/90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            <span className="text-sm font-medium">
              {states.length} Active State(s)
            </span>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border"
      >
        {states.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <Layers className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p>No active states</p>
              <p className="text-xs mt-1">
                States will appear as actions execute
              </p>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ cursor: isPanning ? "grabbing" : "grab" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            className="w-full h-full"
          />
        )}
      </div>

      <div className="mt-2 text-sm text-muted-foreground text-center">
        Drag to pan • Scroll to zoom • Most recent state is in front
      </div>
    </div>
  );
}
