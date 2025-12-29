/**
 * useMonitorCanvas Hook
 *
 * Shared hook for canvas-based visualizations with monitor-aware zoom constraints.
 * Used by ActiveStatesCanvas, TransitionAnimationCanvas, and other workflow visualizations.
 *
 * Features:
 * - Zoom constraints that prevent zooming out beyond visible monitors
 * - Pan/zoom with mouse and wheel
 * - Auto-fit on mount and resize
 * - Support for filtering monitors (all vs only those with elements)
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { Monitor } from "@/lib/schemas/geometry";

// Re-export Monitor type for convenience
export type { Monitor } from "@/lib/schemas/geometry";

// Use the base Monitor type - compatible with both RunnerMonitor and schema Monitor
export type MonitorLike = Monitor;

// ============================================================================
// Types
// ============================================================================

export interface MonitorCanvasOptions {
  /** All available monitors */
  monitors: MonitorLike[];
  /** Indices of monitors that have elements (for filtering) */
  monitorsWithElements?: number[];
  /** Whether to show only monitors with elements */
  showOnlyWithElements?: boolean;
  /** Maximum zoom level (default: 5) */
  maxZoom?: number;
  /** Minimum zoom level floor (default: 0.05) */
  minZoomFloor?: number;
  /** Minimum zoom level for fit-to-view, prevents too-small zoom with multi-monitor (default: none) */
  minFitZoom?: number;
  /** Padding around monitors when calculating fit (default: 40) */
  fitPadding?: number;
  /** Default canvas dimensions when no monitors (default: 1920x1080) */
  defaultDimensions?: { width: number; height: number };
  /** Pin content to top instead of centering vertically (default: false) */
  pinToTop?: boolean;
}

export interface MonitorCanvasBounds {
  /** Canvas width (total extent of all displayed monitors) */
  width: number;
  /** Canvas height (total extent of all displayed monitors) */
  height: number;
  /** X offset to translate absolute screen coords to canvas coords */
  offsetX: number;
  /** Y offset to translate absolute screen coords to canvas coords */
  offsetY: number;
  /** Minimum X coordinate of displayed monitors */
  minX: number;
  /** Minimum Y coordinate of displayed monitors */
  minY: number;
}

export interface UseMonitorCanvasResult {
  // Refs
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;

  // State
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  containerSize: { width: number; height: number };

  // Calculated values
  minZoom: number;
  bounds: MonitorCanvasBounds;
  displayedMonitors: MonitorLike[];

  // Actions
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetView: () => void;
  handleFitView: () => void;

  // Event handlers (attach to container)
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;

  // Wheel handler (automatically attached via useEffect)
  // No need to attach manually
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_DIMENSIONS = { width: 1920, height: 1080 };
const DEFAULT_MAX_ZOOM = 5;
const DEFAULT_MIN_ZOOM_FLOOR = 0.05;
const DEFAULT_FIT_PADDING = 40;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useMonitorCanvas(
  options: MonitorCanvasOptions
): UseMonitorCanvasResult {
  const {
    monitors,
    monitorsWithElements = [],
    showOnlyWithElements = false,
    maxZoom = DEFAULT_MAX_ZOOM,
    minZoomFloor = DEFAULT_MIN_ZOOM_FLOOR,
    minFitZoom,
    fitPadding = DEFAULT_FIT_PADDING,
    defaultDimensions = DEFAULT_DIMENSIONS,
    pinToTop = false,
  } = options;

  // Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Filter monitors based on showOnlyWithElements
  const displayedMonitors = useMemo(() => {
    if (!showOnlyWithElements || monitorsWithElements.length === 0) {
      return monitors;
    }
    const elementIndices = new Set(monitorsWithElements);
    return monitors.filter((m) => elementIndices.has(m.index));
  }, [monitors, monitorsWithElements, showOnlyWithElements]);

  // Calculate canvas bounds from displayed monitors
  const bounds = useMemo((): MonitorCanvasBounds => {
    if (displayedMonitors.length === 0) {
      return {
        width: defaultDimensions.width,
        height: defaultDimensions.height,
        offsetX: 0,
        offsetY: 0,
        minX: 0,
        minY: 0,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    displayedMonitors.forEach((m) => {
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.width);
      maxY = Math.max(maxY, m.y + m.height);
    });

    // Handle negative coordinates (monitors positioned left/top of origin)
    const offsetX = minX < 0 ? -minX : 0;
    const offsetY = minY < 0 ? -minY : 0;

    return {
      width: maxX - minX || defaultDimensions.width,
      height: maxY - minY || defaultDimensions.height,
      offsetX,
      offsetY,
      minX,
      minY,
    };
  }, [displayedMonitors, defaultDimensions]);

  // Calculate minimum zoom to fit all monitors in viewport
  const minZoom = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return minZoomFloor;
    }

    const zoomX = (containerSize.width - fitPadding) / bounds.width;
    const zoomY = (containerSize.height - fitPadding) / bounds.height;

    return Math.max(Math.min(zoomX, zoomY), minZoomFloor);
  }, [containerSize, bounds, fitPadding, minZoomFloor]);

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Auto-fit on mount and when bounds change
  // Use primitive values in deps to ensure stable reference
  const handleFitView = useCallback(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return;

    const zoomX = (containerSize.width - fitPadding) / bounds.width;
    const zoomY = (containerSize.height - fitPadding) / bounds.height;
    // Don't zoom in beyond 1x, and optionally enforce minimum fit zoom
    const fitZoom = Math.max(Math.min(zoomX, zoomY, 1), minFitZoom ?? 0);

    const scaledWidth = bounds.width * fitZoom;
    const scaledHeight = bounds.height * fitZoom;

    // If content fits within container, center it. Otherwise, show left/top edge.
    const panX =
      scaledWidth <= containerSize.width - 2 * fitPadding
        ? (containerSize.width - scaledWidth) / 2 // Center horizontally
        : fitPadding; // Pin to left edge

    const panY =
      pinToTop || scaledHeight > containerSize.height - 2 * fitPadding
        ? fitPadding // Pin to top
        : (containerSize.height - scaledHeight) / 2; // Center vertically

    setZoom(fitZoom);
    setPan({ x: panX, y: panY });
  }, [
    containerSize.width,
    containerSize.height,
    bounds.width,
    bounds.height,
    fitPadding,
    pinToTop,
    minFitZoom,
  ]);

  // Track if we've done initial fit and previous bounds for change detection
  const hasInitialFit = useRef(false);
  const prevBoundsRef = useRef({ width: 0, height: 0, minX: 0, minY: 0 });

  // Auto-fit on initial mount only
  useEffect(() => {
    if (
      containerSize.width > 0 &&
      containerSize.height > 0 &&
      !hasInitialFit.current
    ) {
      hasInitialFit.current = true;
      // Calculate fit values inline to avoid dependency on handleFitView
      const zoomX = (containerSize.width - fitPadding) / bounds.width;
      const zoomY = (containerSize.height - fitPadding) / bounds.height;
      // Don't zoom in beyond 1x, and optionally enforce minimum fit zoom
      const fitZoom = Math.max(Math.min(zoomX, zoomY, 1), minFitZoom ?? 0);

      const scaledWidth = bounds.width * fitZoom;
      const scaledHeight = bounds.height * fitZoom;

      // If content fits within container, center it. Otherwise, show left/top edge.
      const panX =
        scaledWidth <= containerSize.width - 2 * fitPadding
          ? (containerSize.width - scaledWidth) / 2 // Center horizontally
          : fitPadding; // Pin to left edge

      const panY =
        pinToTop || scaledHeight > containerSize.height - 2 * fitPadding
          ? fitPadding // Pin to top
          : (containerSize.height - scaledHeight) / 2; // Center vertically

      setZoom(fitZoom);
      setPan({ x: panX, y: panY });
      prevBoundsRef.current = {
        width: bounds.width,
        height: bounds.height,
        minX: bounds.minX,
        minY: bounds.minY,
      };
    }
  }, [
    containerSize.width,
    containerSize.height,
    bounds.width,
    bounds.height,
    bounds.minX,
    bounds.minY,
    fitPadding,
    pinToTop,
    minFitZoom,
  ]);

  // Re-fit when bounds actually change (monitors added/removed/repositioned)
  useEffect(() => {
    if (!hasInitialFit.current) return;
    const prev = prevBoundsRef.current;
    const boundsChanged =
      prev.width !== bounds.width ||
      prev.height !== bounds.height ||
      prev.minX !== bounds.minX ||
      prev.minY !== bounds.minY;

    if (boundsChanged && containerSize.width > 0 && containerSize.height > 0) {
      const zoomX = (containerSize.width - fitPadding) / bounds.width;
      const zoomY = (containerSize.height - fitPadding) / bounds.height;
      // Don't zoom in beyond 1x, and optionally enforce minimum fit zoom
      const fitZoom = Math.max(Math.min(zoomX, zoomY, 1), minFitZoom ?? 0);

      const scaledWidth = bounds.width * fitZoom;
      const scaledHeight = bounds.height * fitZoom;

      // If content fits within container, center it. Otherwise, show left/top edge.
      const panX =
        scaledWidth <= containerSize.width - 2 * fitPadding
          ? (containerSize.width - scaledWidth) / 2 // Center horizontally
          : fitPadding; // Pin to left edge

      const panY =
        pinToTop || scaledHeight > containerSize.height - 2 * fitPadding
          ? fitPadding // Pin to top
          : (containerSize.height - scaledHeight) / 2; // Center vertically

      setZoom(fitZoom);
      setPan({ x: panX, y: panY });
      prevBoundsRef.current = {
        width: bounds.width,
        height: bounds.height,
        minX: bounds.minX,
        minY: bounds.minY,
      };
    }
  }, [
    bounds.width,
    bounds.height,
    bounds.minX,
    bounds.minY,
    containerSize.width,
    containerSize.height,
    fitPadding,
    pinToTop,
    minFitZoom,
  ]);

  // Constrain pan to keep monitors visible and centered/pinned when smaller than container
  // Use primitive values in deps to ensure stable reference
  const constrainPan = useCallback(
    (newPan: { x: number; y: number }, currentZoom: number) => {
      if (containerSize.width === 0 || containerSize.height === 0)
        return newPan;

      const scaledWidth = bounds.width * currentZoom;
      const scaledHeight = bounds.height * currentZoom;

      let x: number;
      let y: number;

      // If content is smaller than container, center it horizontally
      if (scaledWidth <= containerSize.width - 2 * fitPadding) {
        x = (containerSize.width - scaledWidth) / 2;
      } else {
        // Content is larger - constrain pan to keep it within bounds
        const minPanX = containerSize.width - scaledWidth - fitPadding;
        const maxPanX = fitPadding;
        x = Math.max(minPanX, Math.min(maxPanX, newPan.x));
      }

      // If content is smaller than container, center or pin to top
      if (scaledHeight <= containerSize.height - 2 * fitPadding) {
        y = pinToTop ? fitPadding : (containerSize.height - scaledHeight) / 2;
      } else {
        const minPanY = containerSize.height - scaledHeight - fitPadding;
        const maxPanY = fitPadding;
        y = Math.max(minPanY, Math.min(maxPanY, newPan.y));
      }

      return { x, y };
    },
    [
      containerSize.width,
      containerSize.height,
      bounds.width,
      bounds.height,
      fitPadding,
      pinToTop,
    ]
  );

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((currentZoom) => {
      const newZoom = Math.min(currentZoom * 1.25, maxZoom);
      // Constrain pan for new zoom level
      setPan((currentPan) => constrainPan(currentPan, newZoom));
      return newZoom;
    });
  }, [maxZoom, constrainPan]);

  const handleZoomOut = useCallback(() => {
    setZoom((currentZoom) => {
      const newZoom = Math.max(currentZoom / 1.25, minZoom);
      // Constrain pan for new zoom level
      setPan((currentPan) => constrainPan(currentPan, newZoom));
      return newZoom;
    });
  }, [minZoom, constrainPan]);

  const handleResetView = useCallback(() => {
    const newZoom = 1;
    setZoom(newZoom);
    // Center content at zoom 1
    setPan(constrainPan({ x: 0, y: 0 }, newZoom));
  }, [constrainPan]);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        const newPan = {
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        };
        setPan(constrainPan(newPan, zoom));
      }
    },
    [isPanning, panStart, zoom, constrainPan]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Wheel zoom with mouse-centered zooming
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY > 0 ? 0.9 : 1.1;

      setZoom((currentZoom) => {
        const newZoom = Math.min(
          Math.max(minZoom, currentZoom * delta),
          maxZoom
        );

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Adjust pan to keep mouse position stable during zoom
        setPan((currentPan) => {
          const newPan = {
            x: mouseX - ((mouseX - currentPan.x) * newZoom) / currentZoom,
            y: mouseY - ((mouseY - currentPan.y) * newZoom) / currentZoom,
          };
          // Constrain pan to keep monitors visible
          return constrainPan(newPan, newZoom);
        });

        return newZoom;
      });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [minZoom, maxZoom, constrainPan]);

  return {
    // Refs
    containerRef,
    canvasRef,

    // State
    zoom,
    pan,
    isPanning,
    containerSize,

    // Calculated values
    minZoom,
    bounds,
    displayedMonitors,

    // Actions
    setZoom,
    setPan,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleFitView,

    // Event handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}

// ============================================================================
// Canvas Drawing Utilities
// ============================================================================

export interface MonitorCanvasTheme {
  /** Background color for areas outside monitors */
  outsideColor: string;
  /** Background color for monitor areas */
  monitorBgColor: string;
  /** Border color for monitors */
  monitorBorderColor: string;
  /** Grid line color (with opacity) */
  gridColor: string;
  /** Monitor label text color */
  labelColor: string;
  /** Grid cell size in pixels */
  gridSize: number;
}

export const DEFAULT_THEME: MonitorCanvasTheme = {
  outsideColor: "#6b7280", // grey-500
  monitorBgColor: "#f8fafc", // slate-50
  monitorBorderColor: "#94a3b8", // slate-400
  gridColor: "rgba(148, 163, 184, 0.3)", // slate-400 with opacity
  labelColor: "#64748b", // slate-500
  gridSize: 100,
};

export const DARK_THEME: MonitorCanvasTheme = {
  outsideColor: "#18181b", // zinc-900
  monitorBgColor: "#27272a", // zinc-800
  monitorBorderColor: "#3f3f46", // zinc-700
  gridColor: "rgba(63, 63, 70, 0.3)", // zinc-700 with opacity
  labelColor: "#71717a", // zinc-500
  gridSize: 50,
};

/**
 * Draw the monitor canvas background with grey area outside monitors
 */
export function drawMonitorBackground(
  ctx: CanvasRenderingContext2D,
  bounds: MonitorCanvasBounds,
  monitors: MonitorLike[],
  theme: MonitorCanvasTheme = DEFAULT_THEME
): void {
  // Fill entire canvas with outside color (grey)
  ctx.fillStyle = theme.outsideColor;
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  if (monitors.length > 0) {
    // Draw each monitor area with its background
    monitors.forEach((monitor) => {
      const x = monitor.x - bounds.minX;
      const y = monitor.y - bounds.minY;

      // Monitor background
      ctx.fillStyle = theme.monitorBgColor;
      ctx.fillRect(x, y, monitor.width, monitor.height);

      // Monitor border
      ctx.strokeStyle = theme.monitorBorderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, monitor.width, monitor.height);

      // Draw grid inside monitor
      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 0.5;

      // Vertical grid lines
      for (
        let gx = x + theme.gridSize;
        gx < x + monitor.width;
        gx += theme.gridSize
      ) {
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + monitor.height);
        ctx.stroke();
      }

      // Horizontal grid lines
      for (
        let gy = y + theme.gridSize;
        gy < y + monitor.height;
        gy += theme.gridSize
      ) {
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + monitor.width, gy);
        ctx.stroke();
      }

      // Monitor label
      ctx.font = "12px sans-serif";
      ctx.fillStyle = theme.labelColor;
      ctx.fillText(
        `Monitor ${monitor.index} (${monitor.width}x${monitor.height})`,
        x + 10,
        y + 20
      );
    });
  } else {
    // No monitors - draw single default area
    ctx.fillStyle = theme.monitorBgColor;
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    ctx.strokeStyle = theme.monitorBorderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, bounds.width, bounds.height);

    // Draw grid
    ctx.strokeStyle = theme.gridColor;
    ctx.lineWidth = 0.5;

    for (let x = theme.gridSize; x < bounds.width; x += theme.gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, bounds.height);
      ctx.stroke();
    }

    for (let y = theme.gridSize; y < bounds.height; y += theme.gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(bounds.width, y);
      ctx.stroke();
    }
  }
}

/**
 * Convert absolute screen coordinates to canvas coordinates
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  bounds: MonitorCanvasBounds
): { x: number; y: number } {
  return {
    x: screenX - bounds.minX,
    y: screenY - bounds.minY,
  };
}

/**
 * Convert canvas coordinates to absolute screen coordinates
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  bounds: MonitorCanvasBounds
): { x: number; y: number } {
  return {
    x: canvasX + bounds.minX,
    y: canvasY + bounds.minY,
  };
}

/**
 * Check if a point is inside any of the displayed monitors
 */
export function isPointInMonitors(
  x: number,
  y: number,
  monitors: MonitorLike[]
): boolean {
  return monitors.some(
    (m) => x >= m.x && x <= m.x + m.width && y >= m.y && y <= m.y + m.height
  );
}

/**
 * Get the monitor that contains a point
 */
export function getMonitorAtPoint(
  x: number,
  y: number,
  monitors: MonitorLike[]
): MonitorLike | undefined {
  return monitors.find(
    (m) => x >= m.x && x <= m.x + m.width && y >= m.y && y <= m.y + m.height
  );
}
