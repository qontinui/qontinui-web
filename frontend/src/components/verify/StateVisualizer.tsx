/**
 * StateVisualizer Component
 *
 * Renders a single state with its elements (StateImages, regions, locations)
 * positioned at their fixed screen coordinates.
 *
 * Features:
 * - 1920x1080 canvas (standard screen size)
 * - Displays StateImages at fixed positions
 * - Shows regions and locations
 * - Optional position coordinate display
 * - Element highlighting
 * - Pan and zoom controls
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { State } from "@/contexts/automation-context/types";
import { useAutomation } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

export interface StateVisualizerProps {
  state: State;
  canvasSize: { width: number; height: number };
  showPositions?: boolean;
  highlightElement?: string;
}

export function StateVisualizer({
  state,
  canvasSize,
  showPositions = false,
  highlightElement,
}: StateVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { getImageById } = useAutomation();

  // View state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  // Load images for patterns
  useEffect(() => {
    const imageMap = new Map<string, HTMLImageElement>();
    const loadPromises: Promise<void>[] = [];

    state.stateImages?.forEach((stateImage) => {
      stateImage.patterns?.forEach((pattern) => {
        if (
          pattern.fixed &&
          pattern.imageId &&
          !imageMap.has(pattern.imageId)
        ) {
          const imageAsset = getImageById(pattern.imageId);
          if (imageAsset?.url) {
            const promise = new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                imageMap.set(pattern.imageId!, img);
                resolve();
              };
              img.onerror = () => resolve(); // Continue even if image fails to load
              img.src = imageAsset.url;
            });
            loadPromises.push(promise);
          }
        }
      });
    });

    Promise.all(loadPromises).then(() => {
      setLoadedImages(imageMap);
    });
  }, [state, getImageById]);

  // Auto-fit on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;

    const zoomX = (containerWidth - 80) / canvasSize.width;
    const zoomY = (containerHeight - 80) / canvasSize.height;
    const fitZoom = Math.min(zoomX, zoomY, 1);

    setZoom(fitZoom);
    setPan({
      x: (containerWidth - canvasSize.width * fitZoom) / 2,
      y: (containerHeight - canvasSize.height * fitZoom) / 2,
    });
  }, [canvasSize.width, canvasSize.height]);

  // Draw the canvas
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

    // Draw canvas background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw grid
    drawGrid(ctx);

    // Draw canvas border
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw state elements
    drawStateElements(ctx);

    ctx.restore();
  }, [
    state,
    zoom,
    pan,
    showPositions,
    highlightElement,
    loadedImages,
    canvasSize,
  ]);

  // Draw grid
  const drawGrid = (ctx: CanvasRenderingContext2D) => {
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

    // Draw labels for major grid lines
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px Arial";
    for (let x = 0; x <= canvasSize.width; x += 500) {
      ctx.fillText(`${x}`, x + 5, 15);
    }
    for (let y = 0; y <= canvasSize.height; y += 500) {
      ctx.fillText(`${y}`, 5, y + 15);
    }
  };

  // Draw state elements
  const drawStateElements = (ctx: CanvasRenderingContext2D) => {
    // Draw regions first (background layer)
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

      // Draw region label
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 11px Arial";
      ctx.fillText(region.name, region.x + 5, region.y + 15);

      // Show position coordinates if enabled
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

    // Draw StateImages (middle layer)
    state.stateImages?.forEach((stateImage) => {
      stateImage.patterns?.forEach((pattern) => {
        if (
          pattern.fixed &&
          pattern.offsetX !== undefined &&
          pattern.offsetY !== undefined
        ) {
          const isHighlighted = highlightElement === stateImage.id;
          const img = pattern.imageId
            ? loadedImages.get(pattern.imageId)
            : null;

          if (img) {
            // Calculate dimensions (maintain aspect ratio, default max 100x100)
            const maxWidth = 150;
            const maxHeight = 150;
            const scale = Math.min(
              maxWidth / img.width,
              maxHeight / img.height,
              1
            );
            const width = img.width * scale;
            const height = img.height * scale;

            // Draw image
            ctx.save();
            if (isHighlighted) {
              ctx.shadowColor = "#3b82f6";
              ctx.shadowBlur = 10;
            }
            ctx.drawImage(img, pattern.offsetX, pattern.offsetY, width, height);
            ctx.restore();

            // Draw border
            ctx.strokeStyle = isHighlighted ? "#3b82f6" : "#64748b";
            ctx.lineWidth = isHighlighted ? 3 : 1;
            ctx.strokeRect(pattern.offsetX, pattern.offsetY, width, height);

            // Draw label
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(
              pattern.offsetX,
              pattern.offsetY - 18,
              ctx.measureText(stateImage.name).width + 10,
              16
            );
            ctx.fillStyle = "#1e293b";
            ctx.font = "bold 11px Arial";
            ctx.fillText(
              stateImage.name,
              pattern.offsetX + 5,
              pattern.offsetY - 5
            );

            // Show position coordinates if enabled
            if (showPositions) {
              ctx.fillStyle = "#64748b";
              ctx.font = "10px Arial";
              ctx.fillText(
                `(${pattern.offsetX}, ${pattern.offsetY})`,
                pattern.offsetX + 5,
                pattern.offsetY + height + 12
              );
            }
          } else {
            // Draw placeholder if image not loaded
            const width = 100;
            const height = 100;
            ctx.fillStyle = isHighlighted
              ? "rgba(59, 130, 246, 0.1)"
              : "rgba(148, 163, 184, 0.1)";
            ctx.fillRect(pattern.offsetX, pattern.offsetY, width, height);

            ctx.strokeStyle = isHighlighted ? "#3b82f6" : "#94a3b8";
            ctx.lineWidth = isHighlighted ? 3 : 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(pattern.offsetX, pattern.offsetY, width, height);
            ctx.setLineDash([]);

            // Draw placeholder text
            ctx.fillStyle = "#64748b";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText(
              stateImage.name,
              pattern.offsetX + width / 2,
              pattern.offsetY + height / 2
            );
            ctx.textAlign = "left";

            // Show position coordinates if enabled
            if (showPositions) {
              ctx.fillStyle = "#64748b";
              ctx.font = "10px Arial";
              ctx.fillText(
                `(${pattern.offsetX}, ${pattern.offsetY})`,
                pattern.offsetX + 5,
                pattern.offsetY + height + 12
              );
            }
          }
        }
      });
    });

    // Draw locations (top layer)
    state.locations?.forEach((location) => {
      const isHighlighted = highlightElement === location.id;
      const color = location.fixed
        ? "#dc2626"
        : location.anchor
          ? "#8b5cf6"
          : "#f59e0b";
      const radius = isHighlighted ? 8 : 6;

      // Draw location point
      ctx.fillStyle = color;
      ctx.globalAlpha = isHighlighted ? 1.0 : 0.8;
      ctx.beginPath();
      ctx.arc(location.x, location.y, radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Draw border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = isHighlighted ? 3 : 2;
      ctx.stroke();

      // Draw label
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

        // Show coordinates if enabled
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
  };

  // Redraw on changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Mouse handlers for pan
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
    const containerWidth = containerRef.current?.clientWidth || 800;
    const containerHeight = containerRef.current?.clientHeight || 600;

    const zoomX = (containerWidth - 80) / canvasSize.width;
    const zoomY = (containerHeight - 80) / canvasSize.height;
    const fitZoom = Math.min(zoomX, zoomY, 1);

    setZoom(fitZoom);
    setPan({
      x: (containerWidth - canvasSize.width * fitZoom) / 2,
      y: (containerHeight - canvasSize.height * fitZoom) / 2,
    });
  };

  return (
    <div className="relative flex flex-col h-full">
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
          title="Fit to View"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <div className="text-xs text-center text-muted-foreground px-2">
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* Canvas Info */}
      <div className="absolute top-4 left-4 z-10 bg-background/90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
        <div className="text-sm font-medium">{state.name}</div>
        <div className="text-xs text-muted-foreground">
          {canvasSize.width} × {canvasSize.height}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border bg-white"
      >
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
      </div>

      {/* Instructions */}
      <div className="mt-2 text-sm text-muted-foreground text-center">
        Drag to pan • Scroll to zoom • Click elements in metadata panel to
        highlight
      </div>
    </div>
  );
}
