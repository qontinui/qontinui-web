"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Crosshair,
  Grid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePatternOptimization } from "@/contexts/pattern-optimization-context";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import type {
  Region,
  OptimizationScreenshot,
} from "@/types/pattern-optimization";

interface RegionSelectorProps {
  screenshot: OptimizationScreenshot | null;
}

export function RegionSelector({ screenshot }: RegionSelectorProps) {
  const { setRegion, copyRegionToAll } = usePatternOptimization();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showCrosshair, setShowCrosshair] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const img = imageRef.current;
    if (!canvas || !ctx || !img) return;

    // Set canvas size based on zoom
    const displayWidth = img.width * zoom;
    const displayHeight = img.height * zoom;
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

    // Draw grid
    if (showGrid) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1;
      const gridSize = 10 * zoom;

      for (let x = 0; x <= canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      for (let y = 0; y <= canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    // Draw existing region
    if (currentRegion || screenshot?.region) {
      const region = currentRegion || screenshot?.region;
      if (region) {
        ctx.strokeStyle = "#4A90D9";
        ctx.lineWidth = 2;
        ctx.fillStyle = "rgba(74, 144, 217, 0.2)";

        const x = region.x * zoom;
        const y = region.y * zoom;
        const width = region.width * zoom;
        const height = region.height * zoom;

        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);

        // Draw corner handles
        const handleSize = 6;
        ctx.fillStyle = "#4A90D9";
        ctx.fillRect(
          x - handleSize / 2,
          y - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          x + width - handleSize / 2,
          y - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          x - handleSize / 2,
          y + height - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          x + width - handleSize / 2,
          y + height - handleSize / 2,
          handleSize,
          handleSize
        );

        // Draw dimensions
        ctx.fillStyle = "white";
        ctx.font = "12px monospace";
        ctx.fillText(
          `${Math.round(region.width)}×${Math.round(region.height)}`,
          x + 2,
          y - 4
        );
      }
    }

    // Draw crosshair
    if (showCrosshair && mousePos) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mousePos.x, 0);
      ctx.lineTo(mousePos.x, canvas.height);
      ctx.moveTo(0, mousePos.y);
      ctx.lineTo(canvas.width, mousePos.y);
      ctx.stroke();

      // Show coordinates
      ctx.fillStyle = "white";
      ctx.fillRect(mousePos.x + 10, mousePos.y - 20, 80, 20);
      ctx.fillStyle = "black";
      ctx.font = "12px monospace";
      ctx.fillText(
        `${Math.round(mousePos.x / zoom)}, ${Math.round(mousePos.y / zoom)}`,
        mousePos.x + 15,
        mousePos.y - 5
      );
    }
  }, [screenshot, currentRegion, zoom, showGrid, showCrosshair, mousePos]);

  // Load image and initialize canvas
  useEffect(() => {
    if (!screenshot || !canvasRef.current || !containerRef.current) return;

    const loadImage = async () => {
      try {
        // Try to get image from IndexedDB first
        let imageUrl = await patternOptimizationStorage.getImage(screenshot.id);

        // Fallback to URL if not in IndexedDB (for backward compatibility)
        if (!imageUrl) {
          imageUrl = screenshot.url;
        }

        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          drawCanvas();
        };
        img.onerror = () => {
          toast.error("Failed to load image");
        };
        img.src = imageUrl;
      } catch (error) {
        console.error("Failed to load image:", error);
        toast.error("Failed to load image");
      }
    };

    loadImage();

    // Set initial region if exists
    if (screenshot.region) {
      setCurrentRegion(screenshot.region);
    }
  }, [screenshot, drawCanvas]);

  // Redraw canvas when state changes
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;

      setIsDrawing(true);
      setStartPoint({ x, y });
      setCurrentRegion(null);
    },
    [zoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMousePos({ x, y });

      if (!isDrawing || !startPoint) return;

      const currentX = x / zoom;
      const currentY = y / zoom;

      const region: Region = {
        x: Math.min(startPoint.x, currentX),
        y: Math.min(startPoint.y, currentY),
        width: Math.abs(currentX - startPoint.x),
        height: Math.abs(currentY - startPoint.y),
      };

      setCurrentRegion(region);
    },
    [isDrawing, startPoint, zoom]
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);

    if (
      currentRegion &&
      screenshot &&
      currentRegion.width > 5 &&
      currentRegion.height > 5
    ) {
      setRegion(screenshot.id, currentRegion);
      toast.success("Region set");
    }
  }, [currentRegion, screenshot, setRegion]);

  const handleCopyToAll = useCallback(() => {
    if (!screenshot || !currentRegion) return;
    copyRegionToAll(screenshot.id);
    toast.success("Region copied to all screenshots");
  }, [screenshot, currentRegion, copyRegionToAll]);

  const handleReset = useCallback(() => {
    setCurrentRegion(null);
    if (screenshot) {
      setRegion(screenshot.id, null);
    }
    toast.success("Region cleared");
  }, [screenshot, setRegion]);

  const handleZoomFit = useCallback(() => {
    if (!containerRef.current || !imageRef.current) return;

    const containerWidth = containerRef.current.clientWidth - 32;
    const containerHeight = containerRef.current.clientHeight - 100;
    const imageWidth = imageRef.current.width;
    const imageHeight = imageRef.current.height;

    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    const newZoom = Math.min(scaleX, scaleY, 1);

    setZoom(newZoom);
  }, []);

  if (!screenshot) {
    return (
      <Card className="h-full flex items-center justify-center bg-surface-raised/50 border-border-default">
        <div className="text-center">
          <Crosshair className="w-12 h-12 mx-auto mb-2 text-text-muted" />
          <p className="text-sm text-text-muted">
            Select a screenshot to define region
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 bg-surface-raised/50 rounded">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
            className="h-7 w-7 p-0"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-text-muted w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
            className="h-7 w-7 p-0"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleZoomFit}
            className="h-7 w-7 p-0"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>

          <div className="w-px h-5 bg-border-default" />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowGrid(!showGrid)}
            className={cn("h-7 w-7 p-0", showGrid && "text-brand-primary")}
          >
            <Grid className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowCrosshair(!showCrosshair)}
            className={cn("h-7 w-7 p-0", showCrosshair && "text-brand-primary")}
          >
            <Crosshair className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyToAll}
            disabled={!currentRegion}
            className="h-7 px-2 text-xs border-border-default hover:border-brand-primary"
          >
            <Copy className="w-3 h-3 mr-1" />
            Copy to All
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={!currentRegion}
            className="h-7 px-2 text-xs border-border-default hover:border-red-500"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-surface-raised/50 rounded p-4"
      >
        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setMousePos(null)}
        />
      </div>

      {/* Region info */}
      {currentRegion && (
        <div className="p-2 bg-surface-raised/50 rounded">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Region:</span>
            <span className="font-mono text-brand-primary">
              {Math.round(currentRegion.x)}, {Math.round(currentRegion.y)} •{" "}
              {Math.round(currentRegion.width)}×
              {Math.round(currentRegion.height)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
