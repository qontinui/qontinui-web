import React, { useState, useRef, useEffect, useCallback } from "react";
import { Region } from "@/types/pattern-optimization";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import { ZoomIn, ZoomOut, Maximize2, Move } from "lucide-react";

interface AdvancedRegionSelectorProps {
  screenshotId: string;
  screenshotUrl: string; // ID reference to IndexedDB
  region?: Region;
  onRegionChange: (region: Region) => void;
}

type DragHandle =
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "t"
  | "r"
  | "b"
  | "l"
  | "move"
  | null;

/**
 * Advanced Region Selector with zoom, pan, and adjustable borders
 *
 * Mouse Controls:
 * - Left Click: Select/Draw rectangular regions
 * - Right Click: Pan/Move the image
 * - Mouse Wheel: Zoom in/out
 */
export const AdvancedRegionSelector: React.FC<AdvancedRegionSelectorProps> = ({
  screenshotId,
  screenshotUrl,
  region,
  onRegionChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [imageData, setImageData] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // View state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Interaction state
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<DragHandle>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [currentRegion, setCurrentRegion] = useState<Region | null>(
    region || null
  );

  // Load image from IndexedDB
  useEffect(() => {
    const loadImage = async () => {
      try {
        console.log(
          "[AdvancedRegionSelector] Attempting to load image:",
          screenshotUrl
        );
        const data = await patternOptimizationStorage.getImage(screenshotUrl);

        if (data) {
          console.log("[AdvancedRegionSelector] Loaded from IndexedDB");
          setImageData(data);

          const img = new Image();
          img.onload = () => {
            console.log(
              "[AdvancedRegionSelector] IndexedDB image dimensions:",
              img.width,
              "x",
              img.height
            );
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.src = data;
        } else {
          // Data not found in IndexedDB, use direct URL
          console.log(
            "[AdvancedRegionSelector] Not found in IndexedDB, using direct URL:",
            screenshotUrl
          );
          setImageData(screenshotUrl);

          const img = new Image();
          img.onload = () => {
            console.log(
              "[AdvancedRegionSelector] Direct URL image loaded, dimensions:",
              img.width,
              "x",
              img.height
            );
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.onerror = (e) => {
            console.error(
              "[AdvancedRegionSelector] Failed to load image from direct URL:",
              e
            );
          };
          img.src = screenshotUrl;
        }
      } catch (error) {
        console.error(
          "[AdvancedRegionSelector] IndexedDB error, using direct URL:",
          error
        );
        setImageData(screenshotUrl);

        // Also try to get dimensions from direct URL
        const img = new Image();
        img.onload = () => {
          console.log(
            "[AdvancedRegionSelector] Fallback image loaded, dimensions:",
            img.width,
            "x",
            img.height
          );
          setImageDimensions({ width: img.width, height: img.height });
        };
        img.onerror = (e) => {
          console.error(
            "[AdvancedRegionSelector] Failed to load fallback image:",
            e
          );
        };
        img.src = screenshotUrl;
      }
    };

    loadImage();
  }, [screenshotUrl]);

  // Update region when prop changes
  useEffect(() => {
    if (region) {
      setCurrentRegion(region);
    }
  }, [region]);

  // Draw canvas
  const draw = useCallback(() => {
    if (!canvasRef.current || !imageData || !imageDimensions) {
      console.log(
        "[AdvancedRegionSelector] Draw skipped - missing requirements:",
        {
          hasCanvas: !!canvasRef.current,
          hasImageData: !!imageData,
          hasImageDimensions: !!imageDimensions,
        }
      );
      return;
    }

    console.log(
      "[AdvancedRegionSelector] Drawing canvas with imageData:",
      imageData.substring(0, 50) + "..."
    );

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      console.log(
        "[AdvancedRegionSelector] Image loaded in draw(), drawing to canvas"
      );
      // Set canvas size to container size
      const container = containerRef.current;
      if (!container) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      // Clear canvas
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Apply transformations
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // Draw image
      ctx.drawImage(img, 0, 0, img.width, img.height);

      // Draw region if exists
      if (currentRegion) {
        // Draw semi-transparent selection box (50% opacity blue)
        ctx.fillStyle = "rgba(59, 130, 246, 0.5)";
        ctx.fillRect(
          currentRegion.x,
          currentRegion.y,
          currentRegion.width,
          currentRegion.height
        );

        // Draw selection border
        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(
          currentRegion.x,
          currentRegion.y,
          currentRegion.width,
          currentRegion.height
        );

        // Draw resize handles
        const handleSize = 8 / zoom;
        ctx.fillStyle = "#3B82F6";

        // Corner handles
        ctx.fillRect(
          currentRegion.x - handleSize / 2,
          currentRegion.y - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          currentRegion.x + currentRegion.width - handleSize / 2,
          currentRegion.y - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          currentRegion.x - handleSize / 2,
          currentRegion.y + currentRegion.height - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          currentRegion.x + currentRegion.width - handleSize / 2,
          currentRegion.y + currentRegion.height - handleSize / 2,
          handleSize,
          handleSize
        );

        // Edge handles
        ctx.fillRect(
          currentRegion.x + currentRegion.width / 2 - handleSize / 2,
          currentRegion.y - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          currentRegion.x + currentRegion.width - handleSize / 2,
          currentRegion.y + currentRegion.height / 2 - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          currentRegion.x + currentRegion.width / 2 - handleSize / 2,
          currentRegion.y + currentRegion.height - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fillRect(
          currentRegion.x - handleSize / 2,
          currentRegion.y + currentRegion.height / 2 - handleSize / 2,
          handleSize,
          handleSize
        );

        // Draw dimensions
        ctx.fillStyle = "#3B82F6";
        ctx.font = `${12 / zoom}px monospace`;
        const text = `${Math.round(currentRegion.width)} × ${Math.round(currentRegion.height)}`;
        const textWidth = ctx.measureText(text).width;
        ctx.fillText(
          text,
          currentRegion.x + currentRegion.width / 2 - textWidth / 2,
          currentRegion.y - 5 / zoom
        );
      }

      ctx.restore();
    };

    img.onerror = (e) => {
      console.error(
        "[AdvancedRegionSelector] Failed to load image in draw():",
        e
      );
      console.error(
        "[AdvancedRegionSelector] Image src was:",
        imageData.substring(0, 100)
      );
    };

    img.src = imageData;
  }, [imageData, imageDimensions, zoom, pan, currentRegion]);

  // Redraw when dependencies change
  useEffect(() => {
    // Add a small delay to ensure canvas is mounted
    const timer = setTimeout(() => {
      draw();
    }, 0);
    return () => clearTimeout(timer);
  }, [draw]);

  // Redraw on window resize and when canvas mounts
  useEffect(() => {
    const handleResize = () => {
      console.log("[AdvancedRegionSelector] Window resized, redrawing");
      draw();
    };

    window.addEventListener("resize", handleResize);

    // Initial draw when component mounts with imageData
    if (imageData && imageDimensions) {
      console.log("[AdvancedRegionSelector] Initial draw trigger");
      const timer = setTimeout(() => draw(), 100);
      return () => {
        window.removeEventListener("resize", handleResize);
        clearTimeout(timer);
      };
    }

    return () => window.removeEventListener("resize", handleResize);
  }, [imageData, imageDimensions, draw]);

  // Get mouse position in image coordinates
  const getImageCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    return { x, y };
  };

  // Detect which handle is being hovered/clicked
  const getHandleAtPoint = (x: number, y: number): DragHandle => {
    if (!currentRegion) return null;

    const handleSize = 8 / zoom;
    const threshold = handleSize * 1.5;

    // Check corners first (they take priority)
    if (
      Math.abs(x - currentRegion.x) < threshold &&
      Math.abs(y - currentRegion.y) < threshold
    )
      return "tl";
    if (
      Math.abs(x - (currentRegion.x + currentRegion.width)) < threshold &&
      Math.abs(y - currentRegion.y) < threshold
    )
      return "tr";
    if (
      Math.abs(x - currentRegion.x) < threshold &&
      Math.abs(y - (currentRegion.y + currentRegion.height)) < threshold
    )
      return "bl";
    if (
      Math.abs(x - (currentRegion.x + currentRegion.width)) < threshold &&
      Math.abs(y - (currentRegion.y + currentRegion.height)) < threshold
    )
      return "br";

    // Check edges
    if (
      Math.abs(x - (currentRegion.x + currentRegion.width / 2)) < threshold &&
      Math.abs(y - currentRegion.y) < threshold
    )
      return "t";
    if (
      Math.abs(x - (currentRegion.x + currentRegion.width)) < threshold &&
      Math.abs(y - (currentRegion.y + currentRegion.height / 2)) < threshold
    )
      return "r";
    if (
      Math.abs(x - (currentRegion.x + currentRegion.width / 2)) < threshold &&
      Math.abs(y - (currentRegion.y + currentRegion.height)) < threshold
    )
      return "b";
    if (
      Math.abs(x - currentRegion.x) < threshold &&
      Math.abs(y - (currentRegion.y + currentRegion.height / 2)) < threshold
    )
      return "l";

    // Check if inside region (for moving)
    if (
      x >= currentRegion.x &&
      x <= currentRegion.x + currentRegion.width &&
      y >= currentRegion.y &&
      y <= currentRegion.y + currentRegion.height
    ) {
      return "move";
    }

    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    console.log("[AdvancedRegionSelector] Mouse down");
    const coords = getImageCoords(e);
    if (!coords) {
      console.log("[AdvancedRegionSelector] Could not get image coords");
      return;
    }
    console.log("[AdvancedRegionSelector] Coords:", coords);

    // Right-click for panning
    if (e.button === 2) {
      e.preventDefault();
      setIsPanning(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    // Left-click for selecting/drawing
    if (e.button === 0) {
      // Check if clicking on a handle
      const handle = getHandleAtPoint(coords.x, coords.y);
      if (handle) {
        console.log("[AdvancedRegionSelector] Clicking on handle:", handle);
        setIsDragging(true);
        setDragHandle(handle);
        setDragStart(coords);
      } else {
        // Start drawing new region
        console.log("[AdvancedRegionSelector] Starting new region");
        setIsDrawing(true);
        setDragStart(coords);
        setCurrentRegion(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getImageCoords(e);

    // Update cursor based on hover
    if (!isDrawing && !isDragging && !isPanning && coords) {
      const handle = getHandleAtPoint(coords.x, coords.y);
      if (handle === "move") {
        e.currentTarget.style.cursor = "move";
      } else if (handle === "tl" || handle === "br") {
        e.currentTarget.style.cursor = "nwse-resize";
      } else if (handle === "tr" || handle === "bl") {
        e.currentTarget.style.cursor = "nesw-resize";
      } else if (handle === "t" || handle === "b") {
        e.currentTarget.style.cursor = "ns-resize";
      } else if (handle === "l" || handle === "r") {
        e.currentTarget.style.cursor = "ew-resize";
      } else {
        e.currentTarget.style.cursor = "crosshair";
      }
    }

    if (isPanning && dragStart) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    } else if (isDrawing && dragStart && coords) {
      // Drawing new region
      const newRegion: Region = {
        x: Math.min(dragStart.x, coords.x),
        y: Math.min(dragStart.y, coords.y),
        width: Math.abs(coords.x - dragStart.x),
        height: Math.abs(coords.y - dragStart.y),
      };
      setCurrentRegion(newRegion);
    } else if (
      isDragging &&
      dragHandle &&
      currentRegion &&
      dragStart &&
      coords
    ) {
      // Resizing/moving existing region
      const newRegion = { ...currentRegion };

      switch (dragHandle) {
        case "move":
          const dx = coords.x - dragStart.x;
          const dy = coords.y - dragStart.y;
          newRegion.x = currentRegion.x + dx;
          newRegion.y = currentRegion.y + dy;
          setDragStart(coords);
          break;
        case "tl":
          newRegion.x = coords.x;
          newRegion.y = coords.y;
          newRegion.width = currentRegion.x + currentRegion.width - coords.x;
          newRegion.height = currentRegion.y + currentRegion.height - coords.y;
          break;
        case "tr":
          newRegion.y = coords.y;
          newRegion.width = coords.x - currentRegion.x;
          newRegion.height = currentRegion.y + currentRegion.height - coords.y;
          break;
        case "bl":
          newRegion.x = coords.x;
          newRegion.width = currentRegion.x + currentRegion.width - coords.x;
          newRegion.height = coords.y - currentRegion.y;
          break;
        case "br":
          newRegion.width = coords.x - currentRegion.x;
          newRegion.height = coords.y - currentRegion.y;
          break;
        case "t":
          newRegion.y = coords.y;
          newRegion.height = currentRegion.y + currentRegion.height - coords.y;
          break;
        case "r":
          newRegion.width = coords.x - currentRegion.x;
          break;
        case "b":
          newRegion.height = coords.y - currentRegion.y;
          break;
        case "l":
          newRegion.x = coords.x;
          newRegion.width = currentRegion.x + currentRegion.width - coords.x;
          break;
      }

      // Ensure minimum size
      if (newRegion.width > 10 && newRegion.height > 10) {
        setCurrentRegion(newRegion);
      }
    }
  };

  const handleMouseUp = () => {
    // Save region when finishing drawing or dragging
    if (currentRegion && (isDrawing || isDragging)) {
      // Save region if it's valid size
      if (currentRegion.width > 10 && currentRegion.height > 10) {
        onRegionChange(currentRegion);
        console.log("[AdvancedRegionSelector] Region saved:", currentRegion);
      }
    }

    setIsDrawing(false);
    setIsPanning(false);
    setIsDragging(false);
    setDragHandle(null);
    setDragStart(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(0.1, zoom * delta), 5);
    setZoom(newZoom);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b p-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-600 px-2">
            <span className="font-medium">Left Click:</span> Select/Draw Region
            • <span className="font-medium">Right Click:</span> Pan
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(Math.min(zoom * 1.2, 5))}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-600 font-mono min-w-[60px] text-center">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            onClick={() => setZoom(Math.max(zoom * 0.8, 0.1))}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={resetView}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
            title="Reset view"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {currentRegion && (
          <div className="text-xs text-gray-600">
            Position: ({Math.round(currentRegion.x)},{" "}
            {Math.round(currentRegion.y)}) | Size:{" "}
            {Math.round(currentRegion.width)} ×{" "}
            {Math.round(currentRegion.height)}
          </div>
        )}
      </div>

      {/* Canvas Container */}
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {imageData ? (
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full h-full"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Loading image...
          </div>
        )}
      </div>
    </div>
  );
};
