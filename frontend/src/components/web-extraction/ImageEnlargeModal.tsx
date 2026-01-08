/**
 * Image Enlarge Modal Component
 *
 * Modal for displaying enlarged images with optional pulsating bounding box overlay.
 * Supports zooming and panning.
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { BoundingBox } from "@/types/extraction";

interface ImageEnlargeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  title?: string;
  /** Bounding box to highlight with pulsating animation */
  highlightBox?: BoundingBox | null;
  /** Color for the highlight box */
  highlightColor?: string;
}

export function ImageEnlargeModal({
  open,
  onOpenChange,
  imageUrl,
  title = "Image",
  highlightBox,
  highlightColor = "#00D9FF",
}: ImageEnlargeModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  // Reset zoom/pan when modal opens
  useEffect(() => {
    if (open) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [open]);

  // Load image and get dimensions
  useEffect(() => {
    if (!open || !imageUrl) {
      setIsLoading(true);
      setImageSize(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setIsLoading(false);
    };
    img.onerror = () => {
      setIsLoading(false);
    };
    img.src = imageUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [open, imageUrl]);

  // Draw pulsating bounding box animation
  useEffect(() => {
    if (
      !open ||
      !imageUrl ||
      !highlightBox ||
      !canvasRef.current ||
      !imageSize
    ) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Load image for canvas
    const img = new Image();
    img.src = imageUrl;

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Save context state
      ctx.save();

      // Apply zoom and pan transforms
      ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // Draw image
      if (img.complete) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }

      // Calculate scale factor
      const scaleX = canvas.width / imageSize.width;
      const scaleY = canvas.height / imageSize.height;

      // Draw pulsating bounding box
      const pulse = Math.sin(elapsed / 300) * 0.5 + 0.5; // 0 to 1 pulsing
      const lineWidth = (2 + pulse * 2) / zoom; // Adjust line width for zoom
      const alpha = 0.5 + pulse * 0.5;

      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = alpha;
      ctx.strokeRect(
        highlightBox.x * scaleX,
        highlightBox.y * scaleY,
        highlightBox.width * scaleX,
        highlightBox.height * scaleY
      );

      // Draw glow effect
      ctx.shadowColor = highlightColor;
      ctx.shadowBlur = (10 + pulse * 10) / zoom;
      ctx.strokeRect(
        highlightBox.x * scaleX,
        highlightBox.y * scaleY,
        highlightBox.width * scaleX,
        highlightBox.height * scaleY
      );

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Restore context state
      ctx.restore();

      animationRef.current = requestAnimationFrame(animate);
    };

    img.onload = () => {
      animationRef.current = requestAnimationFrame(animate);
    };

    if (img.complete) {
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [open, imageUrl, highlightBox, highlightColor, imageSize, zoom, pan]);

  // Handle zoom
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.25, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.25, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Handle mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.5, Math.min(5, z * delta)));
  }, []);

  // Handle drag to pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom > 1) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [zoom, pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Calculate display dimensions
  // For long pages, we use a fixed viewport size and allow scrolling/panning
  const getDisplayDimensions = () => {
    if (!imageSize)
      return {
        width: 1200,
        height: 700,
        containerWidth: 1200,
        containerHeight: 700,
      };

    const maxWidth = window.innerWidth * 0.92;
    const maxHeight = window.innerHeight * 0.75;
    const minWidth = Math.min(800, maxWidth);

    const aspectRatio = imageSize.width / imageSize.height;

    // Container size (the visible viewport in the modal)
    const containerWidth = Math.min(
      maxWidth,
      Math.max(minWidth, imageSize.width)
    );
    const containerHeight = Math.min(maxHeight, 700); // Fixed max height for container

    // Image display size - fit to container width, allow height to overflow
    let width = containerWidth;
    let height = width / aspectRatio;

    // If image is wider than tall, fit to container
    if (aspectRatio > containerWidth / containerHeight) {
      width = containerWidth;
      height = width / aspectRatio;
    }

    return { width, height, containerWidth, containerHeight };
  };

  const displayDimensions = getDisplayDimensions();

  // Check if image is taller than container (long page)
  const isLongPage =
    displayDimensions.height > displayDimensions.containerHeight;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[96vw] max-h-[92vh] p-0 overflow-hidden"
        style={{ width: displayDimensions.containerWidth + 48, height: "auto" }}
      >
        <DialogHeader className="p-4 pb-2 flex flex-row items-center justify-between">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              title="Zoom out"
              className="h-8 w-8"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground w-14 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              title="Zoom in"
              className="h-8 w-8"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleResetZoom}
              title="Reset zoom"
              className="h-8 w-8"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div
          ref={containerRef}
          className="p-4 pt-0 flex items-start justify-center overflow-auto"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor: isDragging ? "grabbing" : "grab",
            maxHeight: displayDimensions.containerHeight,
          }}
        >
          {isLoading ? (
            <div
              className="flex items-center justify-center bg-muted rounded-lg"
              style={{
                width: displayDimensions.containerWidth,
                height: displayDimensions.containerHeight,
              }}
            >
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : highlightBox ? (
            <canvas
              ref={canvasRef}
              width={displayDimensions.width}
              height={displayDimensions.height}
              className="rounded-lg flex-shrink-0"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
              }}
            />
          ) : (
            <img
              src={imageUrl || ""}
              alt={title}
              className="rounded-lg flex-shrink-0"
              style={{
                width: displayDimensions.width,
                height: displayDimensions.height,
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
              }}
              draggable={false}
            />
          )}
        </div>

        {imageSize && (
          <div className="px-4 pb-4 text-xs text-muted-foreground text-center">
            Original size: {imageSize.width} x {imageSize.height}px
            {highlightBox && (
              <span className="ml-4">
                Highlight: ({highlightBox.x}, {highlightBox.y}){" "}
                {highlightBox.width}x{highlightBox.height}
              </span>
            )}
            <span className="ml-4">
              {isLongPage
                ? "Scroll to navigate, wheel to zoom"
                : "Scroll to zoom, drag to pan"}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
