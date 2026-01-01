/**
 * Reusable Image Canvas Component with Zoom, Pan, and Box Drawing
 *
 * Features:
 * - Zoom with mouse wheel (up to 50x)
 * - Pan with right-click drag
 * - Draw/resize/move bounding boxes with left-click
 * - Edge detection for precise box resizing
 * - Fully controlled component pattern
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Move } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
}

export interface ImageCanvasProps {
  imageUrl: string;
  boxes: BoundingBox[];
  selectedBoxId?: string | null;
  onBoxesChange?: (boxes: BoundingBox[]) => void;
  onBoxSelect?: (boxId: string | null) => void;
  minBoxSize?: number;
  maxZoom?: number;
  minZoom?: number;
  readonly?: boolean;
  showControls?: boolean;
  className?: string;
}

type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "inside"
  | null;

const CURSORS: Record<
  Exclude<ResizeHandle, null> | "default" | "null",
  string
> = {
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
  inside: "move",
  default: "crosshair",
  null: "default",
};

export function ImageCanvas({
  imageUrl,
  boxes,
  selectedBoxId,
  onBoxesChange,
  onBoxSelect,
  minBoxSize = 5,
  maxZoom = 50,
  minZoom = 0.1,
  readonly = false,
  showControls = true,
  className = "",
}: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // View state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragHandle, setDragHandle] = useState<ResizeHandle>(null);
  const [tempBox, setTempBox] = useState<BoundingBox | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  // Screen to image coordinates
  const screenToImage = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (screenX - rect.left - pan.x) / zoom;
      const y = (screenY - rect.top - pan.y) / zoom;

      return { x, y };
    },
    [zoom, pan]
  );

  // Image to screen coordinates
  const imageToScreen = useCallback(
    (imageX: number, imageY: number) => {
      return {
        x: imageX * zoom + pan.x,
        y: imageY * zoom + pan.y,
      };
    },
    [zoom, pan]
  );

  // Get resize handle at point
  const getHandleAtPoint = useCallback(
    (x: number, y: number, box: BoundingBox): ResizeHandle => {
      const margin = 8 / zoom; // Scale handle detection with zoom

      const left = Math.abs(x - box.x) <= margin;
      const right = Math.abs(x - (box.x + box.width)) <= margin;
      const top = Math.abs(y - box.y) <= margin;
      const bottom = Math.abs(y - (box.y + box.height)) <= margin;

      const insideX = x >= box.x && x <= box.x + box.width;
      const insideY = y >= box.y && y <= box.y + box.height;

      // Check corners
      if (top && left && insideX && insideY) return "nw";
      if (top && right && insideX && insideY) return "ne";
      if (bottom && left && insideX && insideY) return "sw";
      if (bottom && right && insideX && insideY) return "se";

      // Check edges
      if (top && insideX) return "n";
      if (bottom && insideX) return "s";
      if (left && insideY) return "w";
      if (right && insideY) return "e";

      // Check inside
      if (insideX && insideY) return "inside";

      return null;
    },
    [zoom]
  );

  // Find box at point
  const findBoxAtPoint = useCallback(
    (
      x: number,
      y: number
    ): { box: BoundingBox; handle: ResizeHandle } | null => {
      // Check in reverse order (top to bottom)
      for (let i = boxes.length - 1; i >= 0; i--) {
        const box = boxes[i];
        if (!box) continue;
        const handle = getHandleAtPoint(x, y, box);
        if (handle) {
          return { box, handle };
        }
      }
      return null;
    },
    [boxes, getHandleAtPoint]
  );

  // Redraw canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    // Draw boxes
    const allBoxes = tempBox ? [...boxes, tempBox] : boxes;

    allBoxes.forEach((box) => {
      const isSelected = box.id === selectedBoxId;
      const isTemp = box === tempBox;

      const screenPos = imageToScreen(box.x, box.y);
      const screenSize = {
        width: box.width * zoom,
        height: box.height * zoom,
      };

      // Draw box
      ctx.strokeStyle = isTemp ? "#06b6d4" : isSelected ? "#eab308" : "#22c55e";
      ctx.lineWidth = 2;
      if (isTemp) {
        ctx.setLineDash([5, 5]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeRect(
        screenPos.x,
        screenPos.y,
        screenSize.width,
        screenSize.height
      );

      // Draw label
      if (box.label && !isTemp) {
        ctx.fillStyle = isSelected ? "#eab308" : "#22c55e";
        ctx.font = "bold 12px Arial";
        ctx.fillText(box.label, screenPos.x, screenPos.y - 5);
      }

      // Draw resize handles for selected box
      if (isSelected && !readonly) {
        const handleSize = 6;
        const handles = [
          { x: screenPos.x, y: screenPos.y }, // nw
          { x: screenPos.x + screenSize.width / 2, y: screenPos.y }, // n
          { x: screenPos.x + screenSize.width, y: screenPos.y }, // ne
          {
            x: screenPos.x + screenSize.width,
            y: screenPos.y + screenSize.height / 2,
          }, // e
          {
            x: screenPos.x + screenSize.width,
            y: screenPos.y + screenSize.height,
          }, // se
          {
            x: screenPos.x + screenSize.width / 2,
            y: screenPos.y + screenSize.height,
          }, // s
          { x: screenPos.x, y: screenPos.y + screenSize.height }, // sw
          { x: screenPos.x, y: screenPos.y + screenSize.height / 2 }, // w
        ];

        ctx.fillStyle = "#eab308";
        handles.forEach((handle) => {
          ctx.fillRect(
            handle.x - handleSize / 2,
            handle.y - handleSize / 2,
            handleSize,
            handleSize
          );
        });
      }
    });
  }, [boxes, selectedBoxId, zoom, pan, tempBox, imageToScreen, readonly]);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      redraw();
    };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps - we only want to reload when imageUrl changes
  }, [imageUrl]);

  // Redraw on changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (readonly) return;

      const coords = screenToImage(e.clientX, e.clientY);

      // Right-click for panning
      if (e.button === 2) {
        setIsPanning(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setCursor("grabbing");
        return;
      }

      // Left-click for drawing/editing
      if (e.button === 0) {
        const hit = findBoxAtPoint(coords.x, coords.y);

        if (hit) {
          // Clicked on existing box
          setIsDragging(true);
          setDragHandle(hit.handle);
          setDragStart(coords);
          onBoxSelect?.(hit.box.id);
        } else {
          // Start drawing new box
          setIsDrawing(true);
          setDragStart(coords);
          onBoxSelect?.(null);
        }
      }
    },
    [readonly, screenToImage, findBoxAtPoint, onBoxSelect]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = screenToImage(e.clientX, e.clientY);

      // Panning
      if (isPanning && dragStart) {
        setPan({
          x: pan.x + (e.clientX - dragStart.x),
          y: pan.y + (e.clientY - dragStart.y),
        });
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }

      // Drawing new box
      if (isDrawing && dragStart) {
        const newBox: BoundingBox = {
          id: "temp",
          x: Math.min(dragStart.x, coords.x),
          y: Math.min(dragStart.y, coords.y),
          width: Math.abs(coords.x - dragStart.x),
          height: Math.abs(coords.y - dragStart.y),
        };
        setTempBox(newBox);
        return;
      }

      // Dragging/resizing existing box
      if (isDragging && dragStart && selectedBoxId) {
        const selectedBox = boxes.find((b) => b.id === selectedBoxId);
        if (!selectedBox) return;

        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;

        const updatedBox = { ...selectedBox };

        if (dragHandle === "inside") {
          // Move entire box
          updatedBox.x += dx;
          updatedBox.y += dy;
        } else {
          // Resize box
          if (dragHandle?.includes("n")) {
            updatedBox.y += dy;
            updatedBox.height -= dy;
          }
          if (dragHandle?.includes("s")) {
            updatedBox.height += dy;
          }
          if (dragHandle?.includes("w")) {
            updatedBox.x += dx;
            updatedBox.width -= dx;
          }
          if (dragHandle?.includes("e")) {
            updatedBox.width += dx;
          }

          // Ensure positive dimensions
          if (updatedBox.width < 0) {
            updatedBox.x += updatedBox.width;
            updatedBox.width = Math.abs(updatedBox.width);
          }
          if (updatedBox.height < 0) {
            updatedBox.y += updatedBox.height;
            updatedBox.height = Math.abs(updatedBox.height);
          }

          // Enforce minimum size
          updatedBox.width = Math.max(minBoxSize, updatedBox.width);
          updatedBox.height = Math.max(minBoxSize, updatedBox.height);
        }

        // Clamp to image bounds
        if (imageRef.current) {
          updatedBox.x = Math.max(
            0,
            Math.min(imageRef.current.width - updatedBox.width, updatedBox.x)
          );
          updatedBox.y = Math.max(
            0,
            Math.min(imageRef.current.height - updatedBox.height, updatedBox.y)
          );
        }

        const updatedBoxes = boxes.map((b) =>
          b.id === selectedBoxId ? updatedBox : b
        );
        onBoxesChange?.(updatedBoxes);

        setDragStart(coords);
        return;
      }

      // Update cursor based on hover
      if (!readonly && !isDrawing && !isDragging && !isPanning) {
        const hit = findBoxAtPoint(coords.x, coords.y);
        if (hit && hit.handle !== null) {
          setCursor(CURSORS[hit.handle]);
        } else {
          setCursor(CURSORS.default);
        }
      }
    },
    [
      isPanning,
      isDrawing,
      isDragging,
      dragStart,
      dragHandle,
      selectedBoxId,
      boxes,
      pan,
      screenToImage,
      findBoxAtPoint,
      onBoxesChange,
      minBoxSize,
      readonly,
    ]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setCursor(CURSORS.default);
    }

    if (isDrawing && tempBox) {
      // Finalize new box
      if (tempBox.width >= minBoxSize && tempBox.height >= minBoxSize) {
        const newBox: BoundingBox = {
          ...tempBox,
          id: `box-${Date.now()}`,
        };
        onBoxesChange?.([...boxes, newBox]);
        onBoxSelect?.(newBox.id);
      }
      setTempBox(null);
      setIsDrawing(false);
    }

    if (isDragging) {
      setIsDragging(false);
    }

    setDragStart(null);
    setDragHandle(null);
  }, [
    isPanning,
    isDrawing,
    isDragging,
    tempBox,
    boxes,
    minBoxSize,
    onBoxesChange,
    onBoxSelect,
  ]);

  // Handle wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const delta = e.deltaY > 0 ? 0.833 : 1.2;
      const newZoom = Math.min(Math.max(minZoom, zoom * delta), maxZoom);

      // Zoom toward mouse position
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
    },
    [zoom, pan, minZoom, maxZoom]
  );

  // Handle context menu (prevent default)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Resize canvas to container
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
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.2, maxZoom));
  const handleZoomOut = () => setZoom((z) => Math.max(z * 0.833, minZoom));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className={`relative flex flex-col ${className}`}>
      {showControls && (
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-background/80 backdrop-blur-sm rounded-lg p-2 shadow-lg">
          <Button size="sm" variant="outline" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleResetView}>
            <Move className="h-4 w-4" />
          </Button>
          <div className="text-xs text-center text-muted-foreground px-2">
            {Math.round(zoom * 100)}%
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border"
      >
        <canvas
          ref={canvasRef}
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          className="w-full h-full"
        />
      </div>

      {!readonly && (
        <div className="mt-2 text-sm text-muted-foreground text-center">
          Left-click: Draw/Edit • Right-click: Pan • Scroll: Zoom
        </div>
      )}
    </div>
  );
}
