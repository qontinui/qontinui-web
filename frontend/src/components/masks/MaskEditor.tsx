import React, { useState, useRef, useEffect, useCallback } from "react";
import { StateImage } from "../../types/stateDiscovery";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { toast } from "sonner";
import {
  Eraser,
  Brush,
  Square,
  Circle,
  Undo,
  Redo,
  Download,
  RotateCcw,
  Save,
  Maximize,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface MaskEditorProps {
  stateImage: StateImage;
  initialMask?: string; // Base64 encoded mask
  onSave?: (maskData: string) => void;
  onCancel?: () => void;
}

type Tool = "brush" | "eraser" | "rectangle" | "circle";
type EditAction = {
  type: "draw" | "erase";
  points: { x: number; y: number }[];
  tool: Tool;
  size: number;
};

export const MaskEditor: React.FC<MaskEditorProps> = ({
  stateImage,
  initialMask,
  onSave,
  onCancel,
}) => {
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
  const saveMask = () => {
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

  return (
    <div className="mask-editor bg-surface-canvas text-white p-4 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Mask Editor</h2>
        <div className="flex gap-2">
          <Button onClick={saveMask} size="sm" variant="default">
            <Save className="w-4 h-4 mr-1" />
            Save
          </Button>
          {onCancel && (
            <Button onClick={onCancel} size="sm" variant="outline">
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-4">
        {/* Toolbar */}
        <div className="w-16 bg-surface-raised rounded p-2 space-y-2">
          <button
            onClick={() => setTool("brush")}
            className={`w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 ${
              tool === "brush" ? "bg-purple-600" : ""
            }`}
            title="Brush"
          >
            <Brush className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 ${
              tool === "eraser" ? "bg-purple-600" : ""
            }`}
            title="Eraser"
          >
            <Eraser className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTool("rectangle")}
            className={`w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 ${
              tool === "rectangle" ? "bg-purple-600" : ""
            }`}
            title="Rectangle"
          >
            <Square className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTool("circle")}
            className={`w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 ${
              tool === "circle" ? "bg-purple-600" : ""
            }`}
            title="Circle"
          >
            <Circle className="w-5 h-5" />
          </button>
          <div className="h-px bg-surface-raised my-2" />
          <button
            onClick={undo}
            disabled={historyIndex < 0}
            className="w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 disabled:opacity-50"
            title="Undo"
          >
            <Undo className="w-5 h-5" />
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 disabled:opacity-50"
            title="Redo"
          >
            <Redo className="w-5 h-5" />
          </button>
          <button
            onClick={resetMask}
            className="w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80"
            title="Reset"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <div className="h-px bg-surface-raised my-2" />
          <button
            onClick={exportMask}
            className="w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80"
            title="Export"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>

        {/* Canvas Area */}
        <div className="flex flex-col">
          <div className="bg-surface-raised rounded p-4 mb-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <p className="text-sm text-text-muted">
                  Brush Size: {brushSize}px
                </p>
                <Slider
                  value={[brushSize]}
                  onValueChange={(v) => setBrushSize(v[0] ?? 5)}
                  min={1}
                  max={50}
                  step={1}
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <p className="text-sm text-text-muted">
                  Opacity: {Math.round(opacity * 100)}%
                </p>
                <Slider
                  value={[opacity * 100]}
                  onValueChange={(v) => setOpacity(v[0]! / 100)}
                  min={0}
                  max={100}
                  step={5}
                  className="mt-1"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={zoomOut}
                  className="p-2 rounded hover:bg-surface-raised/80"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={resetZoom}
                  className="p-2 rounded hover:bg-surface-raised/80"
                  title="Reset Zoom"
                >
                  <Maximize className="w-4 h-4" />
                </button>
                <button
                  onClick={zoomIn}
                  className="p-2 rounded hover:bg-surface-raised/80"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <span className="text-sm text-text-muted ml-2">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
            </div>

            <div
              className="relative overflow-hidden bg-surface-canvas rounded"
              style={{
                width: "100%",
                height: "500px",
                cursor:
                  tool === "brush"
                    ? "crosshair"
                    : tool === "eraser"
                      ? "grab"
                      : "default",
              }}
            >
              <div
                style={{
                  transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
                  transformOrigin: "top left",
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className="border border-border-default"
                />
                <canvas ref={maskCanvasRef} className="hidden" />
              </div>
            </div>
          </div>

          <div className="text-sm text-text-muted">
            <p>• Use Brush to add to mask, Eraser to remove from mask</p>
            <p>• Hold Shift + drag or use middle mouse to pan</p>
            <p>• Purple overlay shows active mask areas</p>
          </div>
        </div>
      </div>
    </div>
  );
};
