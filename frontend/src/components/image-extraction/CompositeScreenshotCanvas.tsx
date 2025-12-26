import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Region } from "@/types/pattern-optimization";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { MonitorInfo } from "@/components/common/ScreenshotPicker";

/** Screenshot with monitor position for composite display - file not needed */
export interface CompositeScreenshotDisplay {
  id: string;
  name: string;
  url: string;
  monitor: MonitorInfo;
}

interface CompositeScreenshotCanvasProps {
  /** Array of screenshots with their monitor positions */
  screenshots: CompositeScreenshotDisplay[];
  /** Currently selected region */
  region?: Region;
  /** Callback when region changes */
  onRegionChange: (region: Region) => void;
  /** Current zoom level (controlled from parent) */
  zoom?: number;
  /** Current pan X position (controlled from parent) */
  panX?: number;
  /** Current pan Y position (controlled from parent) */
  panY?: number;
  /** Callback when viewport changes */
  onViewportChange?: (viewport: { zoom?: number; panX?: number; panY?: number }) => void;
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

interface LoadedImage {
  screenshot: CompositeScreenshotDisplay;
  image: HTMLImageElement;
}

/**
 * Calculate the bounding box for all monitors
 */
function calculateCompositeBounds(screenshots: CompositeScreenshotDisplay[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (screenshots.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of screenshots) {
    const { x, y, width, height } = s.monitor;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Composite Screenshot Canvas
 *
 * Renders multiple screenshots positioned according to their monitor coordinates.
 * Supports zoom, pan, and region selection that can span multiple monitors.
 *
 * Mouse Controls:
 * - Left Click: Select/Draw rectangular regions
 * - Right Click: Pan/Move the view
 * - Mouse Wheel: Zoom in/out
 */
export const CompositeScreenshotCanvas: React.FC<
  CompositeScreenshotCanvasProps
> = ({ screenshots, region, onRegionChange, zoom: propZoom, panX: propPanX, panY: propPanY, onViewportChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Loaded images
  const [loadedImages, setLoadedImages] = useState<LoadedImage[]>([]);
  const [compositeBounds, setCompositeBounds] = useState<ReturnType<
    typeof calculateCompositeBounds
  > | null>(null);

  // Track which screenshot IDs we've already fit to view
  // This prevents fitToView from being called on every re-render
  const fittedScreenshotIdsRef = useRef<string | null>(null);

  // Track which screenshots we've already loaded to avoid reloading
  const lastLoadedScreenshotKeyRef = useRef<string | null>(null);

  // Create a stable key for the current set of screenshots (used for deduplication)
  const screenshotKey = useMemo(
    () => screenshots.map((s) => s.id).sort().join(","),
    [screenshots]
  );

  // View state - use controlled props if provided, otherwise fall back to internal state
  const isControlled = propZoom !== undefined && onViewportChange !== undefined;
  const [internalZoom, setInternalZoom] = useState(1);
  const [internalPan, setInternalPan] = useState({ x: 0, y: 0 });

  // Use controlled values if provided
  const zoom = isControlled ? propZoom : internalZoom;
  const pan = isControlled ? { x: propPanX ?? 0, y: propPanY ?? 0 } : internalPan;

  // Keep a ref to track the latest zoom value for functional updates
  // This prevents stale closure issues when zoom changes rapidly
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Unified setters that work for both controlled and uncontrolled modes
  const setZoom = useCallback((newZoom: number | ((prev: number) => number)) => {
    // Use ref for functional updates to avoid stale closures
    const currentZoom = zoomRef.current;
    const computedZoom = typeof newZoom === 'function' ? newZoom(currentZoom) : newZoom;
    // Update ref immediately so subsequent calls see the new value
    zoomRef.current = computedZoom;
    if (isControlled) {
      onViewportChange?.({ zoom: computedZoom });
    } else {
      setInternalZoom(computedZoom);
    }
  }, [isControlled, onViewportChange]);

  const setPan = useCallback((newPan: { x: number; y: number }) => {
    if (isControlled) {
      onViewportChange?.({ panX: newPan.x, panY: newPan.y });
    } else {
      setInternalPan(newPan);
    }
  }, [isControlled, onViewportChange]);

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

  // Debug: mount/unmount tracking
  useEffect(() => {
    console.log("[CompositeCanvas] MOUNTED");
    return () => {
      console.log("[CompositeCanvas] UNMOUNTED");
    };
  }, []);

  // Load all images (only when screenshots actually change)
  useEffect(() => {
    console.log(
      "[CompositeCanvas] Screenshots effect triggered:",
      screenshots.length,
      "screenshotKey:",
      screenshotKey,
      "lastKey:",
      lastLoadedScreenshotKeyRef.current
    );

    if (screenshots.length === 0) {
      setLoadedImages([]);
      setCompositeBounds(null);
      lastLoadedScreenshotKeyRef.current = null;
      return;
    }

    // Skip if we've already loaded these screenshots
    if (lastLoadedScreenshotKeyRef.current === screenshotKey) {
      console.log("[CompositeCanvas] Screenshots already loaded, skipping");
      return;
    }

    // Check for valid URLs
    const invalidScreenshots = screenshots.filter(
      (s) => !s.url || s.url === ""
    );
    if (invalidScreenshots.length > 0) {
      console.warn(
        "[CompositeCanvas] Screenshots with missing URLs:",
        invalidScreenshots.map((s) => s.id)
      );
      return;
    }

    const bounds = calculateCompositeBounds(screenshots);
    setCompositeBounds(bounds);

    // Track if this effect is still current (not cancelled)
    let isCancelled = false;

    const loadPromises = screenshots.map((screenshot) => {
      return new Promise<LoadedImage>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          if (!isCancelled) {
            console.log("[CompositeCanvas] Loaded image:", screenshot.id);
            resolve({ screenshot, image: img });
          }
        };
        img.onerror = (err) => {
          if (!isCancelled) {
            console.error(
              "[CompositeCanvas] Failed to load image:",
              screenshot.id,
              "URL:",
              screenshot.url?.substring(0, 80),
              err
            );
            reject(err);
          }
        };
        img.src = screenshot.url;
      });
    });

    Promise.all(loadPromises)
      .then((loaded) => {
        if (!isCancelled) {
          console.log("[CompositeCanvas] All images loaded:", loaded.length);
          lastLoadedScreenshotKeyRef.current = screenshotKey;
          setLoadedImages(loaded);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error("[CompositeCanvas] Failed to load images:", error);
        }
      });

    // Cleanup: cancel any pending operations
    return () => {
      isCancelled = true;
    };
  }, [screenshots, screenshotKey]);

  // Update region when prop changes
  useEffect(() => {
    if (region) {
      setCurrentRegion(region);
    }
  }, [region]);

  // Fit view to show all content - using ref to avoid dependency issues
  const fitToViewRef = useRef<() => void>(() => {});

  // Update the ref whenever compositeBounds changes
  useEffect(() => {
    fitToViewRef.current = () => {
      if (
        !containerRef.current ||
        !compositeBounds ||
        compositeBounds.width === 0
      )
        return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      const padding = 40;
      const availableWidth = containerWidth - padding * 2;
      const availableHeight = containerHeight - padding * 2;

      const scaleX = availableWidth / compositeBounds.width;
      const scaleY = availableHeight / compositeBounds.height;
      const newZoom = Math.min(scaleX, scaleY, 1);

      const centeredX = (containerWidth - compositeBounds.width * newZoom) / 2;
      const centeredY = (containerHeight - compositeBounds.height * newZoom) / 2;

      console.log("[CompositeCanvas] fitToView executing:", { newZoom, centeredX, centeredY });
      setZoom(newZoom);
      setPan({ x: centeredX, y: centeredY });
    };
  }, [compositeBounds]);

  // Stable fitToView function that uses the ref
  const fitToView = useCallback(() => {
    fitToViewRef.current();
  }, []);

  // Track if we've already done initial fitToView for this set of screenshots
  // Store the screenshotKey that was fitted, not just a boolean
  const initialFitDoneForRef = useRef<string | null>(null);

  // Fit to view when a NEW set of images is loaded (not on every re-render)
  // Skip if zoom is already set (i.e., restored from persisted state)
  useEffect(() => {
    if (loadedImages.length === 0) return;

    // Check if we already handled this set of screenshots
    if (initialFitDoneForRef.current === screenshotKey) {
      return;
    }

    // Mark this screenshot set as processed BEFORE scheduling fitToView
    initialFitDoneForRef.current = screenshotKey;
    fittedScreenshotIdsRef.current = screenshotKey;

    // Use setTimeout to ensure:
    // 1. compositeBounds has been updated in the ref
    // 2. Any pending state updates (like hydration) have been processed
    // IMPORTANT: Check zoom INSIDE the timeout to use the latest value after hydration.
    // This prevents a race condition where the zoom check happens before hydration completes,
    // but fitToView runs after hydration has already set the correct zoom.
    setTimeout(() => {
      // Use zoomRef which always has the current zoom value
      const currentZoom = zoomRef.current;
      // Only fit to view if zoom is still at the default value (1)
      // If zoom has been restored from storage or user interacted, skip fitToView
      if (currentZoom === 1) {
        console.log("[CompositeCanvas] Auto fitToView: zoom is default (1)");
        fitToViewRef.current();
      } else {
        console.log("[CompositeCanvas] Skipping auto fitToView: zoom already set to", currentZoom);
      }
    }, 0);

  }, [loadedImages, screenshotKey]);


  // Draw canvas
  const draw = useCallback(() => {
    if (!canvasRef.current || !compositeBounds || loadedImages.length === 0) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Clear canvas with background
    ctx.fillStyle = "#1a1a1b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply transformations
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw each screenshot at its position (normalized to start at 0,0)
    for (const { screenshot, image } of loadedImages) {
      const normalizedX = screenshot.monitor.x - compositeBounds.minX;
      const normalizedY = screenshot.monitor.y - compositeBounds.minY;

      ctx.drawImage(image, normalizedX, normalizedY, image.width, image.height);

      // Draw subtle border around each monitor
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(normalizedX, normalizedY, image.width, image.height);
    }

    // Draw region if exists
    if (currentRegion) {
      // Draw semi-transparent selection box
      ctx.fillStyle = "rgba(0, 217, 255, 0.3)";
      ctx.fillRect(
        currentRegion.x,
        currentRegion.y,
        currentRegion.width,
        currentRegion.height
      );

      // Draw selection border
      ctx.strokeStyle = "#00D9FF";
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(
        currentRegion.x,
        currentRegion.y,
        currentRegion.width,
        currentRegion.height
      );

      // Draw resize handles
      const handleSize = 8 / zoom;
      ctx.fillStyle = "#00D9FF";

      const handles = [
        { x: currentRegion.x, y: currentRegion.y }, // tl
        { x: currentRegion.x + currentRegion.width, y: currentRegion.y }, // tr
        { x: currentRegion.x, y: currentRegion.y + currentRegion.height }, // bl
        {
          x: currentRegion.x + currentRegion.width,
          y: currentRegion.y + currentRegion.height,
        }, // br
        { x: currentRegion.x + currentRegion.width / 2, y: currentRegion.y }, // t
        {
          x: currentRegion.x + currentRegion.width,
          y: currentRegion.y + currentRegion.height / 2,
        }, // r
        {
          x: currentRegion.x + currentRegion.width / 2,
          y: currentRegion.y + currentRegion.height,
        }, // b
        { x: currentRegion.x, y: currentRegion.y + currentRegion.height / 2 }, // l
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

    ctx.restore();

    // Draw monitor labels
    ctx.font = "12px system-ui";
    for (const { screenshot } of loadedImages) {
      const normalizedX = screenshot.monitor.x - compositeBounds.minX;
      const normalizedY = screenshot.monitor.y - compositeBounds.minY;

      const screenX = normalizedX * zoom + pan.x;
      const screenY = normalizedY * zoom + pan.y;

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(screenX + 5, screenY + 5, 85, 20);
      ctx.fillStyle = "#00D9FF";
      ctx.fillText(
        `Monitor ${screenshot.monitor.index}`,
        screenX + 10,
        screenY + 19
      );
    }
  }, [loadedImages, compositeBounds, zoom, pan, currentRegion]);

  // Redraw on state changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      draw();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  // Handle wheel event with passive: false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));

      // Adjust pan to zoom towards mouse position
      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    canvas.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheelEvent);
  }, [zoom, pan]);

  // Convert screen coordinates to image coordinates
  const screenToImage = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };

      const canvasX = screenX - rect.left;
      const canvasY = screenY - rect.top;

      return {
        x: (canvasX - pan.x) / zoom,
        y: (canvasY - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  // Get handle at position
  const getHandleAtPosition = useCallback(
    (imgX: number, imgY: number): DragHandle => {
      if (!currentRegion) return null;

      const handleSize = 12 / zoom;
      const { x, y, width, height } = currentRegion;

      const handles: { pos: DragHandle; x: number; y: number }[] = [
        { pos: "tl", x, y },
        { pos: "tr", x: x + width, y },
        { pos: "bl", x, y: y + height },
        { pos: "br", x: x + width, y: y + height },
        { pos: "t", x: x + width / 2, y },
        { pos: "r", x: x + width, y: y + height / 2 },
        { pos: "b", x: x + width / 2, y: y + height },
        { pos: "l", x, y: y + height / 2 },
      ];

      for (const handle of handles) {
        if (
          Math.abs(imgX - handle.x) < handleSize &&
          Math.abs(imgY - handle.y) < handleSize
        ) {
          return handle.pos;
        }
      }

      // Check if inside region (for move)
      if (imgX >= x && imgX <= x + width && imgY >= y && imgY <= y + height) {
        return "move";
      }

      return null;
    },
    [currentRegion, zoom]
  );

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const imgPos = screenToImage(e.clientX, e.clientY);

      if (e.button === 2) {
        // Right click - pan
        e.preventDefault();
        setIsPanning(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
      }

      if (e.button === 0) {
        // Left click
        const handle = getHandleAtPosition(imgPos.x, imgPos.y);

        if (handle) {
          setIsDragging(true);
          setDragHandle(handle);
          setDragStart(imgPos);
        } else {
          // Start new selection
          setIsDrawing(true);
          setDragStart(imgPos);
          setCurrentRegion({
            x: imgPos.x,
            y: imgPos.y,
            width: 0,
            height: 0,
          });
        }
      }
    },
    [screenToImage, pan, getHandleAtPosition]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const imgPos = screenToImage(e.clientX, e.clientY);

      if (isPanning && dragStart) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
        return;
      }

      if (isDrawing && dragStart) {
        const newRegion = {
          x: Math.min(dragStart.x, imgPos.x),
          y: Math.min(dragStart.y, imgPos.y),
          width: Math.abs(imgPos.x - dragStart.x),
          height: Math.abs(imgPos.y - dragStart.y),
        };
        setCurrentRegion(newRegion);
        return;
      }

      if (isDragging && dragStart && currentRegion && dragHandle) {
        const dx = imgPos.x - dragStart.x;
        const dy = imgPos.y - dragStart.y;

        const newRegion = { ...currentRegion };

        switch (dragHandle) {
          case "move":
            newRegion.x = currentRegion.x + dx;
            newRegion.y = currentRegion.y + dy;
            break;
          case "tl":
            newRegion.x = currentRegion.x + dx;
            newRegion.y = currentRegion.y + dy;
            newRegion.width = currentRegion.width - dx;
            newRegion.height = currentRegion.height - dy;
            break;
          case "tr":
            newRegion.y = currentRegion.y + dy;
            newRegion.width = currentRegion.width + dx;
            newRegion.height = currentRegion.height - dy;
            break;
          case "bl":
            newRegion.x = currentRegion.x + dx;
            newRegion.width = currentRegion.width - dx;
            newRegion.height = currentRegion.height + dy;
            break;
          case "br":
            newRegion.width = currentRegion.width + dx;
            newRegion.height = currentRegion.height + dy;
            break;
          case "t":
            newRegion.y = currentRegion.y + dy;
            newRegion.height = currentRegion.height - dy;
            break;
          case "r":
            newRegion.width = currentRegion.width + dx;
            break;
          case "b":
            newRegion.height = currentRegion.height + dy;
            break;
          case "l":
            newRegion.x = currentRegion.x + dx;
            newRegion.width = currentRegion.width - dx;
            break;
        }

        // Ensure positive dimensions
        if (newRegion.width < 0) {
          newRegion.x += newRegion.width;
          newRegion.width = Math.abs(newRegion.width);
        }
        if (newRegion.height < 0) {
          newRegion.y += newRegion.height;
          newRegion.height = Math.abs(newRegion.height);
        }

        setCurrentRegion(newRegion);
        setDragStart(imgPos);
        return;
      }

      // Update cursor based on hover
      const handle = getHandleAtPosition(imgPos.x, imgPos.y);
      const canvas = canvasRef.current;
      if (canvas) {
        switch (handle) {
          case "tl":
          case "br":
            canvas.style.cursor = "nwse-resize";
            break;
          case "tr":
          case "bl":
            canvas.style.cursor = "nesw-resize";
            break;
          case "t":
          case "b":
            canvas.style.cursor = "ns-resize";
            break;
          case "l":
          case "r":
            canvas.style.cursor = "ew-resize";
            break;
          case "move":
            canvas.style.cursor = "move";
            break;
          default:
            canvas.style.cursor = "crosshair";
        }
      }
    },
    [
      screenToImage,
      isPanning,
      isDrawing,
      isDragging,
      dragStart,
      dragHandle,
      currentRegion,
      getHandleAtPosition,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (isDrawing || isDragging) {
      if (
        currentRegion &&
        currentRegion.width > 0 &&
        currentRegion.height > 0
      ) {
        onRegionChange(currentRegion);
      }
    }

    setIsDrawing(false);
    setIsPanning(false);
    setIsDragging(false);
    setDragHandle(null);
    setDragStart(null);
  }, [isDrawing, isDragging, currentRegion, onRegionChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  if (screenshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <p className="text-sm">No screenshots captured</p>
          <p className="text-xs mt-1">Capture screens to view composite</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />

      {/* Controls */}
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        <button
          onClick={() => setZoom((z) => Math.min(10, z * 1.2))}
          className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4 text-white" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.1, z / 1.2))}
          className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4 text-white" />
        </button>
        <button
          onClick={fitToView}
          className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          title="Fit to View"
        >
          <Maximize2 className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Info overlay */}
      <div className="absolute bottom-4 left-4 bg-gray-800/80 rounded-lg px-3 py-2 text-xs text-gray-300">
        <div>Monitors: {screenshots.length}</div>
        {compositeBounds && (
          <div>
            Composite: {compositeBounds.width} × {compositeBounds.height}px
          </div>
        )}
        <div data-zoom-value={zoom}>Zoom: {Math.round(zoom * 100)}%</div>
        {currentRegion && currentRegion.width > 0 && (
          <div className="text-[#00D9FF]">
            Region: {Math.round(currentRegion.width)} ×{" "}
            {Math.round(currentRegion.height)}px
          </div>
        )}
      </div>
    </div>
  );
};
