"use client";

import { useEffect, useRef, useCallback } from "react";
import type { BoundingBox } from "@/stores/extraction-annotation-store";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import {
  type Viewport,
  COLORS,
  REVIEW_COLORS,
  isElementVisible,
  debounce,
} from "./annotation-editor-types";

export function useAnnotationCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  imageRef: React.RefObject<HTMLImageElement | null>,
  imageLoaded: boolean,
  currentDrawRect: BoundingBox | null
) {
  const rafRef = useRef<number | null>(null);

  const {
    selectedElementIds,
    hoveredElementId,
    showLabels,
    showConfidence,
    showReviewStatus,
    zoom,
    pan,
    selectionBox,
    isSelectingBox,
    getVisibleElements,
    grid,
  } = useExtractionAnnotationStore();

  const getViewport = useCallback((): Viewport => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: canvas.width / zoom,
      height: canvas.height / zoom,
    };
  }, [canvasRef, pan, zoom]);

  const draw = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const img = imageRef.current;

      if (!canvas || !ctx) return;

      const container = containerRef.current;
      if (!container) return;

      const { width: containerWidth, height: containerHeight } =
        container.getBoundingClientRect();
      canvas.width = containerWidth;
      canvas.height = containerHeight;

      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (img && imageLoaded) {
        ctx.save();
        ctx.translate(pan.x, pan.y);
        ctx.scale(zoom, zoom);
        ctx.drawImage(img, 0, 0);

        if (grid.enabled && grid.showGuides) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
          ctx.lineWidth = 1 / zoom;

          const viewport = getViewport();
          const startX = Math.floor(viewport.x / grid.size) * grid.size;
          const startY = Math.floor(viewport.y / grid.size) * grid.size;
          const endX = Math.min(
            img.width,
            viewport.x + viewport.width + grid.size
          );
          const endY = Math.min(
            img.height,
            viewport.y + viewport.height + grid.size
          );

          for (let x = startX; x <= endX; x += grid.size) {
            ctx.beginPath();
            ctx.moveTo(x, Math.max(0, startY));
            ctx.lineTo(x, Math.min(img.height, endY));
            ctx.stroke();
          }

          for (let y = startY; y <= endY; y += grid.size) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, startX), y);
            ctx.lineTo(Math.min(img.width, endX), y);
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      const viewport = getViewport();
      const visibleElements = getVisibleElements();
      const elementsToRender = visibleElements.filter((element) =>
        isElementVisible(element, viewport)
      );

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      for (const element of elementsToRender) {
        const isSelected = selectedElementIds.includes(element.id);
        const isHovered = element.id === hoveredElementId;
        const isGroundTruth = element.isGroundTruth;

        let colors = COLORS.normal;
        if (isGroundTruth) {
          colors = isSelected ? COLORS.groundTruthSelected : COLORS.groundTruth;
        } else if (isSelected) {
          colors = COLORS.selected;
        } else if (isHovered) {
          colors = COLORS.hovered;
        }

        ctx.fillStyle = colors.fill;
        ctx.fillRect(
          element.bbox.x,
          element.bbox.y,
          element.bbox.width,
          element.bbox.height
        );

        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
        ctx.strokeRect(
          element.bbox.x,
          element.bbox.y,
          element.bbox.width,
          element.bbox.height
        );

        if (showReviewStatus && element.reviewStatus) {
          const indicatorSize = 12 / zoom;
          const indicatorX =
            element.bbox.x + element.bbox.width - indicatorSize - 4 / zoom;
          const indicatorY = element.bbox.y + 4 / zoom;

          ctx.fillStyle = REVIEW_COLORS[element.reviewStatus];
          ctx.beginPath();
          ctx.arc(
            indicatorX + indicatorSize / 2,
            indicatorY + indicatorSize / 2,
            indicatorSize / 2,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }

        if (showLabels && element.label) {
          const fontSize = Math.max(10, 12 / zoom);
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = colors.stroke;

          let labelText = element.label;
          if (showConfidence) {
            labelText += ` (${(element.confidence * 100).toFixed(0)}%)`;
          }

          const metrics = ctx.measureText(labelText);
          const labelHeight = fontSize + 4;
          const labelY = element.bbox.y - labelHeight - 2;

          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(element.bbox.x, labelY, metrics.width + 6, labelHeight);

          ctx.fillStyle = colors.stroke;
          ctx.fillText(labelText, element.bbox.x + 3, element.bbox.y - 6);
        }

        if (isSelected) {
          const handleSize = 8 / zoom;
          ctx.fillStyle = colors.stroke;

          const handles = [
            { x: element.bbox.x, y: element.bbox.y },
            { x: element.bbox.x + element.bbox.width, y: element.bbox.y },
            { x: element.bbox.x, y: element.bbox.y + element.bbox.height },
            {
              x: element.bbox.x + element.bbox.width,
              y: element.bbox.y + element.bbox.height,
            },
          ];

          for (const handle of handles) {
            ctx.fillRect(
              handle.x - handleSize / 2,
              handle.y - handleSize / 2,
              handleSize,
              handleSize
            );
          }
        }
      }

      if (currentDrawRect) {
        ctx.fillStyle = COLORS.drawing.fill;
        ctx.fillRect(
          currentDrawRect.x,
          currentDrawRect.y,
          currentDrawRect.width,
          currentDrawRect.height
        );

        ctx.strokeStyle = COLORS.drawing.stroke;
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([5 / zoom, 5 / zoom]);
        ctx.strokeRect(
          currentDrawRect.x,
          currentDrawRect.y,
          currentDrawRect.width,
          currentDrawRect.height
        );
        ctx.setLineDash([]);
      }

      if (selectionBox && isSelectingBox) {
        ctx.fillStyle = COLORS.selectionBox.fill;
        ctx.fillRect(
          selectionBox.x,
          selectionBox.y,
          selectionBox.width,
          selectionBox.height
        );

        ctx.strokeStyle = COLORS.selectionBox.stroke;
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.strokeRect(
          selectionBox.x,
          selectionBox.y,
          selectionBox.width,
          selectionBox.height
        );
        ctx.setLineDash([]);
      }

      ctx.restore();
      rafRef.current = null;
    });
  }, [
    canvasRef,
    containerRef,
    imageRef,
    getVisibleElements,
    selectedElementIds,
    hoveredElementId,
    showLabels,
    showConfidence,
    showReviewStatus,
    zoom,
    pan,
    imageLoaded,
    currentDrawRect,
    selectionBox,
    isSelectingBox,
    getViewport,
    grid,
  ]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Redraw on state changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on resize with debounce for performance
  useEffect(() => {
    const handleResize = debounce(() => draw(), 16);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);
}
