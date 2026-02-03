/**
 * Annotation Editor Component
 *
 * Main canvas component for viewing and editing element annotations.
 * Features:
 * - Display screenshot with overlay bounding boxes
 * - Draw new bounding boxes
 * - Multi-select with Shift+click or selection box
 * - Move and resize existing boxes
 * - Zoom and pan
 * - Keyboard shortcuts
 * - Grid overlay and snap-to-grid
 * - Review status indicators
 * - Viewport culling for performance with many elements
 * - Debounced rendering for smooth pan/zoom
 */

"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import {
  useExtractionAnnotationStore,
  type AnnotatedElement,
  type BoundingBox,
  type ReviewStatus,
} from "@/stores/extraction-annotation-store";

/**
 * Represents the visible viewport area in image coordinates.
 * Used for culling elements outside the visible area.
 */
interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationEditorProps {
  className?: string;
}

// Colors for different states
const COLORS = {
  normal: { fill: "rgba(155, 89, 182, 0.15)", stroke: "#9B59B6" },
  selected: { fill: "rgba(155, 89, 182, 0.3)", stroke: "#9B59B6" },
  hovered: { fill: "rgba(155, 89, 182, 0.25)", stroke: "#9B59B6" },
  groundTruth: { fill: "rgba(39, 174, 96, 0.15)", stroke: "#27AE60" },
  groundTruthSelected: { fill: "rgba(39, 174, 96, 0.3)", stroke: "#27AE60" },
  drawing: { fill: "rgba(52, 152, 219, 0.2)", stroke: "#3498DB" },
  selectionBox: { fill: "rgba(52, 152, 219, 0.1)", stroke: "#3498DB" },
};

// Review status colors
const REVIEW_COLORS: Record<ReviewStatus, string> = {
  pending: "#F39C12",
  approved: "#27AE60",
  rejected: "#E74C3C",
  needs_revision: "#9B59B6",
};

/**
 * Check if an element's bounding box is visible within the viewport.
 * Used for viewport culling to skip rendering off-screen elements.
 */
function isElementVisible(element: AnnotatedElement, viewport: Viewport): boolean {
  const { x, y, width, height } = element.bbox;
  return !(
    x + width < viewport.x ||
    x > viewport.x + viewport.width ||
    y + height < viewport.y ||
    y > viewport.y + viewport.height
  );
}

/**
 * Debounce function for smooth pan/zoom updates.
 */
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function AnnotationEditor({ className }: AnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentDrawRect, setCurrentDrawRect] = useState<BoundingBox | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  const store = useExtractionAnnotationStore();
  const {
    selectedElementIds,
    hoveredElementId,
    activeTool,
    showLabels,
    showConfidence,
    showReviewStatus,
    screenshotUrl,
    zoom,
    pan,
    setPan,
    isDrawing,
    drawStart,
    selectionBox,
    isSelectingBox,
    setScreenshot,
    selectElement,
    setHoveredElement,
    addElement,
    deleteElement,
    deleteElements,
    setDrawing,
    setZoom,
    getVisibleElements,
    grid,
    startSelectionBox,
    updateSelectionBox,
    endSelectionBox,
    undo,
    redo,
  } = store;

  // Load image when screenshot URL changes
  useEffect(() => {
    if (!screenshotUrl) {
      setImageLoaded(false);
      imageRef.current = null;
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setScreenshot(screenshotUrl, img.width, img.height);
      setImageLoaded(true);
    };
    img.onerror = () => {
      console.error("Failed to load screenshot");
      setImageLoaded(false);
    };
    img.src = screenshotUrl;
  }, [screenshotUrl, setScreenshot]);

  // Get element at point
  const getElementAtPoint = useCallback(
    (x: number, y: number): AnnotatedElement | null => {
      const visibleElements = getVisibleElements();
      // Check in reverse order (top elements first)
      for (let i = visibleElements.length - 1; i >= 0; i--) {
        const el = visibleElements[i];
        if (!el) continue;
        if (
          x >= el.bbox.x &&
          x <= el.bbox.x + el.bbox.width &&
          y >= el.bbox.y &&
          y <= el.bbox.y + el.bbox.height
        ) {
          return el;
        }
      }
      return null;
    },
    [getVisibleElements]
  );

  // Convert screen coordinates to image coordinates
  const screenToImage = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (screenX - rect.left - pan.x) / zoom;
      const y = (screenY - rect.top - pan.y) / zoom;
      return { x: Math.round(x), y: Math.round(y) };
    },
    [pan, zoom]
  );

  // Calculate the current viewport in image coordinates
  const getViewport = useCallback((): Viewport => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: canvas.width / zoom,
      height: canvas.height / zoom,
    };
  }, [pan, zoom]);

  // Memoize visible elements filtered by ground truth setting
  const visibleElements = useMemo(() => {
    return getVisibleElements();
  }, [getVisibleElements]);

  // Draw the canvas with viewport culling and requestAnimationFrame
  const draw = useCallback(() => {
    // Cancel any pending animation frame
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const img = imageRef.current;

      if (!canvas || !ctx) return;

      // Get container size
      const container = containerRef.current;
      if (!container) return;

      // Set canvas size to match container
      const { width: containerWidth, height: containerHeight } =
        container.getBoundingClientRect();
      canvas.width = containerWidth;
      canvas.height = containerHeight;

      // Clear canvas
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw image if loaded
      if (img && imageLoaded) {
        ctx.save();
        ctx.translate(pan.x, pan.y);
        ctx.scale(zoom, zoom);
        ctx.drawImage(img, 0, 0);

        // Draw grid if enabled
        if (grid.enabled && grid.showGuides) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
          ctx.lineWidth = 1 / zoom;

          // Only draw grid lines within the visible viewport for performance
          const viewport = getViewport();
          const startX = Math.floor(viewport.x / grid.size) * grid.size;
          const startY = Math.floor(viewport.y / grid.size) * grid.size;
          const endX = Math.min(img.width, viewport.x + viewport.width + grid.size);
          const endY = Math.min(img.height, viewport.y + viewport.height + grid.size);

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

      // Get viewport for culling
      const viewport = getViewport();

      // Filter elements to only those visible in the viewport
      const elementsToRender = visibleElements.filter((element) =>
        isElementVisible(element, viewport)
      );

      // Draw elements
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

    for (const element of elementsToRender) {
      const isSelected = selectedElementIds.includes(element.id);
      const isHovered = element.id === hoveredElementId;
      const isGroundTruth = element.isGroundTruth;

      // Determine colors
      let colors = COLORS.normal;
      if (isGroundTruth) {
        colors = isSelected ? COLORS.groundTruthSelected : COLORS.groundTruth;
      } else if (isSelected) {
        colors = COLORS.selected;
      } else if (isHovered) {
        colors = COLORS.hovered;
      }

      // Draw filled rectangle
      ctx.fillStyle = colors.fill;
      ctx.fillRect(
        element.bbox.x,
        element.bbox.y,
        element.bbox.width,
        element.bbox.height
      );

      // Draw border
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
      ctx.strokeRect(
        element.bbox.x,
        element.bbox.y,
        element.bbox.width,
        element.bbox.height
      );

      // Draw review status indicator
      if (showReviewStatus && element.reviewStatus) {
        const indicatorSize = 12 / zoom;
        const indicatorX = element.bbox.x + element.bbox.width - indicatorSize - 4 / zoom;
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

      // Draw label
      if (showLabels && element.label) {
        const fontSize = Math.max(10, 12 / zoom);
        ctx.font = `${fontSize}px monospace`;
        ctx.fillStyle = colors.stroke;

        let labelText = element.label;
        if (showConfidence) {
          labelText += ` (${(element.confidence * 100).toFixed(0)}%)`;
        }

        // Background for label
        const metrics = ctx.measureText(labelText);
        const labelHeight = fontSize + 4;
        const labelY = element.bbox.y - labelHeight - 2;

        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(
          element.bbox.x,
          labelY,
          metrics.width + 6,
          labelHeight
        );

        ctx.fillStyle = colors.stroke;
        ctx.fillText(labelText, element.bbox.x + 3, element.bbox.y - 6);
      }

      // Draw resize handles for selected elements
      if (isSelected) {
        const handleSize = 8 / zoom;
        ctx.fillStyle = colors.stroke;

        const handles = [
          { x: element.bbox.x, y: element.bbox.y }, // top-left
          { x: element.bbox.x + element.bbox.width, y: element.bbox.y }, // top-right
          { x: element.bbox.x, y: element.bbox.y + element.bbox.height }, // bottom-left
          {
            x: element.bbox.x + element.bbox.width,
            y: element.bbox.y + element.bbox.height,
          }, // bottom-right
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

    // Draw current drawing rectangle
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

    // Draw selection box
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
    visibleElements,
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
    const handleResize = debounce(() => draw(), 16); // ~60fps
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const shiftKey = e.shiftKey;

      if (activeTool === "select") {
        const element = getElementAtPoint(x, y);
        if (element) {
          selectElement(element.id, shiftKey);
        } else if (!shiftKey) {
          // Start selection box
          startSelectionBox({ x, y });
        }
      } else if (activeTool === "draw") {
        setDrawing(true, { x, y });
        setCurrentDrawRect({ x, y, width: 0, height: 0 });
      } else if (activeTool === "delete") {
        const element = getElementAtPoint(x, y);
        if (element) {
          deleteElement(element.id);
        }
      } else if (activeTool === "pan") {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [activeTool, screenToImage, getElementAtPoint, selectElement, setDrawing, deleteElement, pan, startSelectionBox]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = screenToImage(e.clientX, e.clientY);

      // Pan mode
      if (isPanning && panStart) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
        return;
      }

      // Update hover state
      if (activeTool === "select" || activeTool === "delete") {
        const element = getElementAtPoint(x, y);
        setHoveredElement(element?.id || null);
      }

      // Update selection box
      if (isSelectingBox) {
        updateSelectionBox({ x, y });
        return;
      }

      // Update drawing rectangle
      if (isDrawing && drawStart) {
        const width = x - drawStart.x;
        const height = y - drawStart.y;

        setCurrentDrawRect({
          x: width >= 0 ? drawStart.x : x,
          y: height >= 0 ? drawStart.y : y,
          width: Math.abs(width),
          height: Math.abs(height),
        });
      }
    },
    [
      activeTool,
      isDrawing,
      drawStart,
      isPanning,
      panStart,
      isSelectingBox,
      screenToImage,
      getElementAtPoint,
      setHoveredElement,
      setPan,
      updateSelectionBox,
    ]
  );

  const handleMouseUp = useCallback(() => {
    // End panning
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    // End selection box
    if (isSelectingBox) {
      endSelectionBox();
      return;
    }

    // End drawing
    if (isDrawing && currentDrawRect) {
      // Only add if rectangle has reasonable size
      if (currentDrawRect.width >= 10 && currentDrawRect.height >= 10) {
        addElement({
          bbox: currentDrawRect,
          label: "New Element",
          elementType: "button",
          confidence: 1.0,
          isGroundTruth: true,
          isAutoDetected: false,
        });
      }
    }

    setDrawing(false, null);
    setCurrentDrawRect(null);
  }, [isDrawing, isPanning, isSelectingBox, currentDrawRect, addElement, setDrawing, endSelectionBox]);

  const handleMouseLeave = useCallback(() => {
    setHoveredElement(null);
    if (isDrawing) {
      setDrawing(false, null);
      setCurrentDrawRect(null);
    }
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
    if (isSelectingBox) {
      endSelectionBox();
    }
  }, [isDrawing, isPanning, isSelectingBox, setHoveredElement, setDrawing, endSelectionBox]);

  // Wheel handler for zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(zoom * delta);
    },
    [zoom, setZoom]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (selectedElementIds.length > 0) {
            e.preventDefault();
            deleteElements(selectedElementIds);
          }
          break;
        case "z":
          if (isCtrlOrCmd) {
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
          }
          break;
        case "y":
          if (isCtrlOrCmd) {
            e.preventDefault();
            redo();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedElementIds, deleteElements, undo, redo]);

  // Get cursor style
  const getCursor = () => {
    if (isPanning) return "grabbing";
    switch (activeTool) {
      case "select":
        return "default";
      case "draw":
        return "crosshair";
      case "delete":
        return "not-allowed";
      case "pan":
        return "grab";
      default:
        return "default";
    }
  };

  if (!screenshotUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-canvas border border-border-subtle rounded-lg ${className}`}
      >
        <div className="text-center text-text-muted py-16">
          <p className="text-sm">No screenshot loaded</p>
          <p className="text-xs mt-1 opacity-60">
            Run an extraction or load a screenshot to start annotating
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-[#1a1a2e] border border-border-subtle rounded-lg ${className}`}
    >
      {!imageLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-canvas/80">
          <Loader2 className="h-6 w-6 animate-spin text-[#9B59B6]" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: getCursor() }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
    </div>
  );
}
