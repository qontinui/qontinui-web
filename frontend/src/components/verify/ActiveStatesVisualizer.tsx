/**
 * ActiveStatesVisualizer Component
 *
 * Visualizes multiple active states simultaneously on a canvas.
 * Shows all state elements (images, regions, locations) at their fixed positions.
 * Multiple states can overlap, demonstrating the composite UI at that workflow step.
 */

import React, { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { State } from "@/stores/automation";

export interface ActiveStatesVisualizerProps {
  activeStates: State[];
  canvasSize: { width: number; height: number };
  showStateLabels?: boolean;
}

/**
 * Color palette for different states (to distinguish overlapping states)
 */
// Using CSS variable values for consistency with design system
// Note: These are runtime color values, not Tailwind classes, since they're used in canvas drawing
const STATE_COLORS = [
  "var(--color-brand-primary)", // Primary (cyan)
  "#FF6B9D", // Pink
  "#FFD93D", // Yellow
  "var(--color-brand-success)", // Success (green)
  "var(--color-brand-secondary)", // Secondary (purple)
  "#F97316", // Orange
  "#EC4899", // Magenta
  "#14B8A6", // Teal
];

/**
 * Get a consistent color for a state based on its ID
 */
function getStateColor(_stateId: string, index: number): string {
  return (
    STATE_COLORS[index % STATE_COLORS.length] ??
    STATE_COLORS[0] ??
    "var(--color-brand-primary)"
  );
}

export function ActiveStatesVisualizer({
  activeStates,
  canvasSize,
  showStateLabels = true,
}: ActiveStatesVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Draw the visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // Clear canvas
    // Using canvas background color (surface-canvas equivalent)
    ctx.fillStyle = "#0A0A0B";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid for reference
    drawGrid(ctx, canvas.width, canvas.height);

    // Draw each active state
    activeStates.forEach((state, index) => {
      const color = getStateColor(state.id, index);
      drawState(ctx, state, color, showStateLabels);
    });
  }, [activeStates, canvasSize, showStateLabels]);

  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    ctx.strokeStyle = "#1A1A1B";
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = 0; x < width; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y < height; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  };

  const drawState = (
    ctx: CanvasRenderingContext2D,
    state: State,
    color: string,
    showLabel: boolean
  ) => {
    // Draw state position marker
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(state.position.x, state.position.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Draw state name
    if (showLabel) {
      ctx.font = "bold 14px sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(state.name, state.position.x + 15, state.position.y + 5);
    }

    // Draw regions
    if (state.regions && state.regions.length > 0) {
      state.regions.forEach((region) => {
        if (!region.bounds) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(
          region.bounds.x,
          region.bounds.y,
          region.bounds.width,
          region.bounds.height
        );

        // Fill with semi-transparent color
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(
          region.bounds.x,
          region.bounds.y,
          region.bounds.width,
          region.bounds.height
        );
        ctx.globalAlpha = 1;

        // Draw region name
        if (showLabel && region.name) {
          ctx.font = "12px sans-serif";
          ctx.fillStyle = color;
          ctx.fillText(
            region.name,
            region.bounds.x + 5,
            region.bounds.y + region.bounds.height - 5
          );
        }
      });
    }

    // Draw locations
    if (state.locations && state.locations.length > 0) {
      state.locations.forEach((location) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(location.x, location.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Draw location name
        if (showLabel && location.name) {
          ctx.font = "11px sans-serif";
          ctx.fillStyle = color;
          ctx.fillText(location.name, location.x + 8, location.y + 4);
        }
      });
    }

    // Draw state images (represented as colored rectangles with labels)
    if (state.stateImages && state.stateImages.length > 0) {
      state.stateImages.forEach((stateImage, imgIndex) => {
        // For visualization, we'll place images in a grid around the state position
        const offsetX = (imgIndex % 3) * 120;
        const offsetY = Math.floor(imgIndex / 3) * 80;

        const x = state.position.x + offsetX;
        const y = state.position.y + offsetY + 30;

        // Draw image placeholder
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x, y, 100, 60);
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x, y, 100, 60);
        ctx.globalAlpha = 1;

        // Draw image name
        if (showLabel) {
          ctx.font = "11px sans-serif";
          ctx.fillStyle = color;
          ctx.fillText(stateImage.name, x + 5, y + 15);

          // Draw pattern count
          ctx.font = "10px sans-serif";
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.fillText(
            `${stateImage.patterns.length} pattern(s)`,
            x + 5,
            y + 30
          );
          ctx.globalAlpha = 1;
        }
      });
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.1, 2));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.1, 0.2));
  };

  const handleResetZoom = () => {
    setZoom(0.5);
    setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  if (!activeStates || activeStates.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-surface-canvas rounded-lg border border-border-subtle">
        <div className="text-center">
          <div className="text-text-muted mb-2">
            No active states at this step
          </div>
          <div className="text-xs text-text-muted">
            States will appear here as the workflow progresses
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Zoom Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleZoomOut}
            size="sm"
            variant="outline"
            className="bg-surface-raised/50 border-border-subtle text-text-muted hover:text-text-secondary"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm text-text-muted min-w-[60px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            onClick={handleZoomIn}
            size="sm"
            variant="outline"
            className="bg-surface-raised/50 border-border-subtle text-text-muted hover:text-text-secondary"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleResetZoom}
            size="sm"
            variant="outline"
            className="bg-surface-raised/50 border-border-subtle text-text-muted hover:text-text-secondary"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="text-xs text-text-muted">Click and drag to pan</div>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        role="application"
        aria-label="State visualization canvas"
        className={cn(
          "relative overflow-hidden rounded-lg border border-border-subtle",
          "bg-surface-canvas",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{ height: "500px" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {activeStates.map((state, index) => {
          const color = getStateColor(state.id, index);
          return (
            <div
              key={state.id}
              className="flex items-center gap-2 text-xs bg-surface-raised/50 px-3 py-1.5 rounded border border-border-subtle"
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-text-secondary">{state.name}</span>
              <span className="text-text-muted">
                ({state.stateImages?.length || 0} images,{" "}
                {state.regions?.length || 0} regions,{" "}
                {state.locations?.length || 0} locations)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
