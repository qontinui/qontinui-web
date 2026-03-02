import { useState, useCallback, RefObject } from "react";
import type { BoundingBox, ResizeHandle } from "../_types/image-canvas";
import { CURSORS } from "../_types/image-canvas";

interface UseBoxInteractionOptions {
  boxes: BoundingBox[];
  selectedBoxId?: string | null;
  onBoxesChange?: (boxes: BoundingBox[]) => void;
  onBoxSelect?: (boxId: string | null) => void;
  minBoxSize: number;
  readonly: boolean;
  zoom: number;
  pan: { x: number; y: number };
  setPan: (pan: { x: number; y: number }) => void;
  screenToImage: (screenX: number, screenY: number) => { x: number; y: number };
  imageRef: RefObject<HTMLImageElement | null>;
}

export function useBoxInteraction({
  boxes,
  selectedBoxId,
  onBoxesChange,
  onBoxSelect,
  minBoxSize,
  readonly,
  zoom,
  pan,
  setPan,
  screenToImage,
  imageRef,
}: UseBoxInteractionOptions) {
  const [isPanning, setIsPanning] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragHandle, setDragHandle] = useState<ResizeHandle>(null);
  const [tempBox, setTempBox] = useState<BoundingBox | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  const getHandleAtPoint = useCallback(
    (x: number, y: number, box: BoundingBox): ResizeHandle => {
      const margin = 8 / zoom;

      const left = Math.abs(x - box.x) <= margin;
      const right = Math.abs(x - (box.x + box.width)) <= margin;
      const top = Math.abs(y - box.y) <= margin;
      const bottom = Math.abs(y - (box.y + box.height)) <= margin;

      const insideX = x >= box.x && x <= box.x + box.width;
      const insideY = y >= box.y && y <= box.y + box.height;

      if (top && left && insideX && insideY) return "nw";
      if (top && right && insideX && insideY) return "ne";
      if (bottom && left && insideX && insideY) return "sw";
      if (bottom && right && insideX && insideY) return "se";

      if (top && insideX) return "n";
      if (bottom && insideX) return "s";
      if (left && insideY) return "w";
      if (right && insideY) return "e";

      if (insideX && insideY) return "inside";

      return null;
    },
    [zoom]
  );

  const findBoxAtPoint = useCallback(
    (
      x: number,
      y: number
    ): { box: BoundingBox; handle: ResizeHandle } | null => {
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (readonly) return;

      const coords = screenToImage(e.clientX, e.clientY);

      if (e.button === 2) {
        setIsPanning(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setCursor("grabbing");
        return;
      }

      if (e.button === 0) {
        const hit = findBoxAtPoint(coords.x, coords.y);

        if (hit) {
          setIsDragging(true);
          setDragHandle(hit.handle);
          setDragStart(coords);
          onBoxSelect?.(hit.box.id);
        } else {
          setIsDrawing(true);
          setDragStart(coords);
          onBoxSelect?.(null);
        }
      }
    },
    [readonly, screenToImage, findBoxAtPoint, onBoxSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = screenToImage(e.clientX, e.clientY);

      if (isPanning && dragStart) {
        setPan({
          x: pan.x + (e.clientX - dragStart.x),
          y: pan.y + (e.clientY - dragStart.y),
        });
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }

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

      if (isDragging && dragStart && selectedBoxId) {
        const selectedBox = boxes.find((b) => b.id === selectedBoxId);
        if (!selectedBox) return;

        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;

        const updatedBox = { ...selectedBox };

        if (dragHandle === "inside") {
          updatedBox.x += dx;
          updatedBox.y += dy;
        } else {
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

          if (updatedBox.width < 0) {
            updatedBox.x += updatedBox.width;
            updatedBox.width = Math.abs(updatedBox.width);
          }
          if (updatedBox.height < 0) {
            updatedBox.y += updatedBox.height;
            updatedBox.height = Math.abs(updatedBox.height);
          }

          updatedBox.width = Math.max(minBoxSize, updatedBox.width);
          updatedBox.height = Math.max(minBoxSize, updatedBox.height);
        }

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
      setPan,
      imageRef,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setCursor(CURSORS.default);
    }

    if (isDrawing && tempBox) {
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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return {
    tempBox,
    cursor,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  };
}
