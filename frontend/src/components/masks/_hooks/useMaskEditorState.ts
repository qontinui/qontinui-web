import { useState, useRef, useEffect, useCallback } from "react";
import { StateImage } from "../../../types/stateDiscovery";
import { toast } from "sonner";
import type { Tool, EditAction } from "../types";

interface UseMaskEditorStateOptions {
  stateImage: StateImage;
  initialMask?: string;
}

export function useMaskEditorState({
  stateImage,
  initialMask,
}: UseMaskEditorStateOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(10);
  const [opacity, setOpacity] = useState(0.5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<EditAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [currentAction, setCurrentAction] = useState<EditAction | null>(null);

  // Redraw composite image
  const redrawComposite = useCallback(() => {
    if (!canvasRef.current || !maskCanvasRef.current) return;

    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw base image/placeholder
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#999";
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.fillText(stateImage.name, 10, 25);

    // Overlay mask with transparency
    ctx.save();
    ctx.globalAlpha = opacity;

    // Use mask as alpha channel for purple overlay
    const maskCtx = maskCanvas.getContext("2d");
    if (maskCtx) {
      const imageData = ctx.createImageData(
        maskCanvas.width,
        maskCanvas.height
      );
      const maskData = maskCtx.getImageData(
        0,
        0,
        maskCanvas.width,
        maskCanvas.height
      );

      // Create purple overlay where mask is active
      for (let i = 0; i < maskData.data.length; i += 4) {
        imageData.data[i] = 147; // R
        imageData.data[i + 1] = 51; // G
        imageData.data[i + 2] = 234; // B
        imageData.data[i + 3] = maskData.data[i] ?? 0; // Use mask as alpha
      }

      ctx.putImageData(imageData, 0, 0);
    }
    ctx.restore();
  }, [stateImage, opacity]);

  // Initialize canvases
  useEffect(() => {
    if (!canvasRef.current || !maskCanvasRef.current) return;

    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const maskCtx = maskCanvas.getContext("2d");

    if (!ctx || !maskCtx) return;

    // Set canvas sizes
    canvas.width = stateImage.width;
    canvas.height = stateImage.height;
    maskCanvas.width = stateImage.width;
    maskCanvas.height = stateImage.height;

    // Initialize mask
    if (initialMask) {
      const img = new Image();
      img.onload = () => {
        maskCtx.drawImage(img, 0, 0);
      };
      img.src = initialMask;
    } else {
      // Start with full mask
      maskCtx.fillStyle = "white";
      maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }

    // Draw state image placeholder
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#999";
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.fillText(stateImage.name, 10, 25);

    redrawComposite();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redrawComposite is intentionally excluded to prevent re-initialization loops
  }, [stateImage, initialMask]);

  // Get mouse position relative to canvas
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - panOffset.x) / zoom,
      y: (e.clientY - rect.top - panOffset.y) / zoom,
    };
  };

  // Draw on mask
  const drawOnMask = (x: number, y: number) => {
    if (!maskCanvasRef.current) return;
    const ctx = maskCanvasRef.current.getContext("2d");
    if (!ctx) return;

    const fillColor = tool === "eraser" ? "white" : "black";
    console.log("Tool:", tool, "Color:", fillColor);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = fillColor;

    if (tool === "brush" || tool === "eraser") {
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, 2 * Math.PI);
      ctx.fill();
    }

    redrawComposite();
  };

  // Replay history up to a given index
  const replayHistory = (toIndex: number) => {
    if (!maskCanvasRef.current) return;
    const ctx = maskCanvasRef.current.getContext("2d");
    if (!ctx) return;

    // Clear mask
    ctx.clearRect(
      0,
      0,
      maskCanvasRef.current.width,
      maskCanvasRef.current.height
    );
    ctx.fillStyle = "white";
    ctx.fillRect(
      0,
      0,
      maskCanvasRef.current.width,
      maskCanvasRef.current.height
    );

    // Replay actions up to index
    for (let i = 0; i <= toIndex; i++) {
      const action = history[i];
      if (!action) continue;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = action.type === "erase" ? "white" : "black";

      for (const point of action.points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, action.size / 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    redrawComposite();
  };

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle mouse or Shift+Left for panning
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else if (e.button === 0) {
      // Left mouse for drawing
      setIsDrawing(true);
      const pos = getMousePos(e);
      setCurrentAction({
        type: tool === "eraser" ? "erase" : "draw",
        points: [pos],
        tool,
        size: brushSize,
      });
      drawOnMask(pos.x, pos.y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else if (isDrawing) {
      const pos = getMousePos(e);
      if (currentAction) {
        currentAction.points.push(pos);
      }
      drawOnMask(pos.x, pos.y);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentAction) {
      // Add to history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentAction);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentAction(null);
    }
    setIsDrawing(false);
    setIsPanning(false);
  };

  // Undo/Redo
  const undo = () => {
    if (historyIndex >= 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      replayHistory(newIndex);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      replayHistory(newIndex);
    }
  };

  // Reset mask
  const resetMask = () => {
    if (!maskCanvasRef.current) return;
    const ctx = maskCanvasRef.current.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "white";
    ctx.fillRect(
      0,
      0,
      maskCanvasRef.current.width,
      maskCanvasRef.current.height
    );
    setHistory([]);
    setHistoryIndex(-1);
    redrawComposite();
    toast.info("Mask reset to full");
  };

  // Save mask
  const saveMask = (onSave?: (maskData: string) => void) => {
    if (!maskCanvasRef.current) return;

    // Convert mask canvas to base64
    const maskData = maskCanvasRef.current.toDataURL("image/png");

    if (onSave) {
      onSave(maskData);
      toast.success("Mask saved");
    }
  };

  // Export mask
  const exportMask = () => {
    if (!maskCanvasRef.current) return;

    const link = document.createElement("a");
    link.download = `mask_${stateImage.id}.png`;
    link.href = maskCanvasRef.current.toDataURL();
    link.click();
    toast.success("Mask exported");
  };

  // Zoom controls
  const zoomIn = () => setZoom((prev) => Math.min(prev * 1.2, 5));
  const zoomOut = () => setZoom((prev) => Math.max(prev / 1.2, 0.5));
  const resetZoom = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return {
    // Refs
    canvasRef,
    maskCanvasRef,

    // Tool state
    tool,
    setTool,
    brushSize,
    setBrushSize,
    opacity,
    setOpacity,

    // History state
    historyIndex,
    historyLength: history.length,
    undo,
    redo,
    resetMask,

    // Zoom/pan state
    zoom,
    panOffset,

    // Actions
    saveMask,
    exportMask,
    zoomIn,
    zoomOut,
    resetZoom,

    // Mouse handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
