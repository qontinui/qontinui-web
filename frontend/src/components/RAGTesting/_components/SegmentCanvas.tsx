"use client";

import React, { useEffect } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { SegmentWithMatches } from "@/types/rag-testing";
import { getScoreColor, formatScore, hexToRgb } from "../rag-testing-utils";

interface SegmentCanvasProps {
  currentScreenshotUrl: string | null | undefined;
  segments: SegmentWithMatches[];
  selectedSegmentId: string | null;
  hoveredSegmentId: string | null;
  showSegmentation: boolean;
  showLabels: boolean;
  highlightMatches: boolean;
  maskImages: Map<string, HTMLImageElement>;
  zoom: number;
  pan: { x: number; y: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleCanvasMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseUp: () => void;
  handleWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
}

export function SegmentCanvas({
  currentScreenshotUrl,
  segments,
  selectedSegmentId,
  hoveredSegmentId,
  showSegmentation,
  showLabels,
  highlightMatches,
  maskImages,
  zoom,
  pan,
  canvasRef,
  containerRef,
  handleCanvasClick,
  handleCanvasMove,
  handleMouseDown,
  handleMouseUp,
  handleWheel,
}: SegmentCanvasProps) {
  // Draw canvas with zoom/pan transforms (like Extract Images page)
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !currentScreenshotUrl)
      return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    const img = new Image();
    img.onload = () => {
      // Set canvas size to container size (fixed display area)
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      // Clear canvas with background
      ctx.fillStyle = "hsl(var(--surface-raised))";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Apply zoom/pan transforms
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // Draw image
      ctx.drawImage(img, 0, 0);

      // Draw segments with pixel masks
      segments.forEach((segment) => {
        const isHovered = hoveredSegmentId === segment.id;
        const isSelected = selectedSegmentId === segment.id;
        const hasMatch = segment.bestMatch !== null;
        const score = segment.bestMatch?.score ?? 0;

        // Determine color based on match score
        let color = "#808080"; // Gray for no match
        if (hasMatch && highlightMatches) {
          color = getScoreColor(score);
        }

        const { bbox } = segment;

        // Draw pixel mask (SAM3 segmentation)
        if (showSegmentation) {
          const maskImg = maskImages.get(segment.id);
          if (maskImg) {
            // Create a temporary canvas for colorizing the mask
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = maskImg.width;
            tempCanvas.height = maskImg.height;
            const tempCtx = tempCanvas.getContext("2d");

            if (tempCtx) {
              // Draw the grayscale mask
              tempCtx.drawImage(maskImg, 0, 0);

              // Get mask image data
              const maskData = tempCtx.getImageData(
                0,
                0,
                maskImg.width,
                maskImg.height
              );
              const data = maskData.data;

              const rgb = hexToRgb(color);
              const alpha = isSelected ? 0.6 : isHovered ? 0.5 : 0.35;

              // Colorize the mask - for each pixel, if it's white (part of segment), apply color
              for (let i = 0; i < data.length; i += 4) {
                const brightness = data[i] ?? 0; // Grayscale value (0-255)
                if (brightness > 127) {
                  // This pixel is part of the segment
                  data[i] = rgb.r;
                  data[i + 1] = rgb.g;
                  data[i + 2] = rgb.b;
                  data[i + 3] = Math.floor(alpha * 255);
                } else {
                  // Transparent
                  data[i + 3] = 0;
                }
              }

              tempCtx.putImageData(maskData, 0, 0);

              // Draw the colorized mask onto main canvas at the bbox position
              ctx.drawImage(
                tempCanvas,
                bbox.x,
                bbox.y,
                bbox.width,
                bbox.height
              );

              // Draw outline for selected/hovered segments
              if (isSelected || isHovered) {
                ctx.strokeStyle = color;
                ctx.lineWidth = isSelected ? 3 : 2;
                if (isSelected) {
                  ctx.shadowColor = color;
                  ctx.shadowBlur = 10;
                }
                ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
                ctx.shadowBlur = 0;
              }
            }
          } else {
            // Fallback: draw bounding box if mask not available
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
            ctx.setLineDash([]);
          }
        }

        // Draw label (scale font with zoom)
        if (showLabels && (isSelected || isHovered) && segment.bestMatch) {
          const label = segment.bestMatch.element_name;
          const scoreText = formatScore(segment.bestMatch.score);

          ctx.font = `${12 / zoom}px Inter, sans-serif`;
          const textWidth = ctx.measureText(`${label} (${scoreText})`).width;

          // Background
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(
            bbox.x,
            bbox.y - 22 / zoom,
            textWidth + 12 / zoom,
            20 / zoom
          );

          // Text
          ctx.fillStyle = color;
          ctx.fillText(
            `${label} (${scoreText})`,
            bbox.x + 6 / zoom,
            bbox.y - 8 / zoom
          );
        }
      });

      // Restore context after drawing
      ctx.restore();
    };
    img.src = currentScreenshotUrl;
  }, [
    currentScreenshotUrl,
    segments,
    selectedSegmentId,
    hoveredSegmentId,
    showSegmentation,
    showLabels,
    highlightMatches,
    maskImages,
    zoom,
    pan,
    canvasRef,
    containerRef,
  ]);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden">
      {currentScreenshotUrl ? (
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full h-full cursor-crosshair"
        />
      ) : (
        <div className="h-full flex items-center justify-center text-text-muted">
          <div className="text-center">
            <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p>Select a screenshot to begin</p>
          </div>
        </div>
      )}
    </div>
  );
}
