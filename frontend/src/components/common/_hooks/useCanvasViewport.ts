import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type RefObject,
} from "react";

/** Point type used throughout the viewport hook. */
export interface ViewportPoint {
  x: number;
  y: number;
}

/** Dimensions of content to fit within the viewport. */
export interface ContentSize {
  width: number;
  height: number;
}

/**
 * Viewport change payload for controlled mode.
 * Only the changed fields are included.
 */
export interface ViewportChangePayload {
  zoom?: number;
  panX?: number;
  panY?: number;
}

export interface UseCanvasViewportOptions {
  /**
   * Ref to the canvas element. Used for coordinate conversion
   * and wheel event positioning. If not provided, screenToImage
   * and imageToScreen will not be available.
   */
  canvasRef?: RefObject<HTMLCanvasElement | null>;

  /** Ref to the container div. Used for fitToContent calculations. */
  containerRef?: RefObject<HTMLDivElement | null>;

  /** Minimum allowed zoom level. @default 0.1 */
  minZoom?: number;

  /** Maximum allowed zoom level. @default 10 */
  maxZoom?: number;

  /**
   * Controlled zoom value. When provided along with onViewportChange,
   * the hook operates in controlled mode (zoom state is external).
   */
  controlledZoom?: number;

  /** Controlled pan X value for controlled mode. */
  controlledPanX?: number;

  /** Controlled pan Y value for controlled mode. */
  controlledPanY?: number;

  /**
   * Callback for controlled mode. Called when the viewport changes.
   * Only present fields should be applied by the parent.
   */
  onViewportChange?: (payload: ViewportChangePayload) => void;

  /**
   * Content size for fitToContent calculations.
   * When provided, enables the fitToContent helper and auto-fit behavior.
   */
  contentSize?: ContentSize | null;

  /**
   * Padding (in pixels) around the content when fitting to view.
   * @default 40
   */
  fitPadding?: number;

  /**
   * When true, automatically fit content on mount and when contentSize changes.
   * Only triggers once per unique contentSize.
   * @default false
   */
  autoFit?: boolean;

  /**
   * Enable mouse-drag panning. When enabled, the hook returns mouse
   * event handlers (handleMouseDown, handleMouseMove, handleMouseUp)
   * and an isPanning state.
   * @default false
   */
  enableMousePan?: boolean;
}

export interface UseCanvasViewportReturn {
  /** Current zoom level. */
  zoom: number;

  /** Current pan offset. */
  pan: ViewportPoint;

  /** Whether the user is currently panning via mouse drag. */
  isPanning: boolean;

  /**
   * Set zoom directly. Accepts a value or an updater function.
   * Works in both controlled and uncontrolled modes.
   */
  setZoom: (value: number | ((prev: number) => number)) => void;

  /**
   * Set pan directly. Accepts a value or an updater function.
   * Works in both controlled and uncontrolled modes.
   */
  setPan: (
    value: ViewportPoint | ((prev: ViewportPoint) => ViewportPoint)
  ) => void;

  /** Convert screen coordinates to image/canvas coordinates. */
  screenToImage: (screenX: number, screenY: number) => ViewportPoint;

  /** Convert image/canvas coordinates to screen coordinates. */
  imageToScreen: (imageX: number, imageY: number) => ViewportPoint;

  /** Wheel event handler with mouse-point zoom. Attach to onWheel. */
  handleWheel: (e: React.WheelEvent) => void;

  /** Zoom in by a step (1.2x). */
  zoomIn: () => void;

  /** Zoom out by a step (1/1.2x). */
  zoomOut: () => void;

  /** Reset to zoom=1, pan={0,0}. */
  resetView: () => void;

  /**
   * Fit content within the container. Requires contentSize and containerRef.
   * Uses fitPadding and caps at zoom=1 so content is never upscaled.
   */
  fitToContent: () => void;

  /** Mouse down handler for drag-panning. Only meaningful when enableMousePan is true. */
  handleMouseDown: (e: React.MouseEvent) => void;

  /** Mouse move handler for drag-panning. Only meaningful when enableMousePan is true. */
  handleMouseMove: (e: React.MouseEvent) => void;

  /** Mouse up handler for drag-panning. Only meaningful when enableMousePan is true. */
  handleMouseUp: () => void;
}

export function useCanvasViewport(
  options: UseCanvasViewportOptions = {}
): UseCanvasViewportReturn {
  const {
    canvasRef,
    containerRef,
    minZoom = 0.1,
    maxZoom = 10,
    controlledZoom,
    controlledPanX,
    controlledPanY,
    onViewportChange,
    contentSize,
    fitPadding = 40,
    autoFit = false,
    enableMousePan = false,
  } = options;

  // --- Controlled vs uncontrolled mode ---
  const isControlled =
    controlledZoom !== undefined && onViewportChange !== undefined;

  const [internalZoom, setInternalZoom] = useState(1);
  const [internalPan, setInternalPan] = useState<ViewportPoint>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<ViewportPoint | null>(null);

  const zoom = isControlled ? controlledZoom : internalZoom;
  const pan: ViewportPoint = isControlled
    ? { x: controlledPanX ?? 0, y: controlledPanY ?? 0 }
    : internalPan;

  // Refs to avoid stale closures in callbacks
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const isControlledRef = useRef(isControlled);
  const onViewportChangeRef = useRef(onViewportChange);

  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
    isControlledRef.current = isControlled;
    onViewportChangeRef.current = onViewportChange;
  });

  // --- Setters that work in both modes ---
  const setZoom = useCallback((value: number | ((prev: number) => number)) => {
    const currentZoom = zoomRef.current;
    const computed = typeof value === "function" ? value(currentZoom) : value;
    if (isControlledRef.current && onViewportChangeRef.current) {
      onViewportChangeRef.current({ zoom: computed });
    } else {
      setInternalZoom(computed);
    }
  }, []);

  const setPan = useCallback(
    (value: ViewportPoint | ((prev: ViewportPoint) => ViewportPoint)) => {
      const currentPan = panRef.current;
      const computed = typeof value === "function" ? value(currentPan) : value;
      if (isControlledRef.current && onViewportChangeRef.current) {
        onViewportChangeRef.current({ panX: computed.x, panY: computed.y });
      } else {
        setInternalPan(computed);
      }
    },
    []
  );

  // --- Coordinate conversion ---
  const screenToImage = useCallback(
    (screenX: number, screenY: number): ViewportPoint => {
      const canvas = canvasRef?.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      return {
        x: (screenX - rect.left - panRef.current.x) / zoomRef.current,
        y: (screenY - rect.top - panRef.current.y) / zoomRef.current,
      };
    },
    [canvasRef]
  );

  const imageToScreen = useCallback(
    (imageX: number, imageY: number): ViewportPoint => {
      return {
        x: imageX * zoomRef.current + panRef.current.x,
        y: imageY * zoomRef.current + panRef.current.y,
      };
    },
    []
  );

  // --- Wheel zoom (mouse-point zoom) ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const newZoom = Math.min(Math.max(minZoom, currentZoom * delta), maxZoom);

      // Determine the element rect for mouse-point zoom
      const targetEl = canvasRef?.current ?? (e.currentTarget as HTMLElement);
      const rect = targetEl?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        setPan({
          x: mouseX - ((mouseX - currentPan.x) * newZoom) / currentZoom,
          y: mouseY - ((mouseY - currentPan.y) * newZoom) / currentZoom,
        });
      }

      setZoom(newZoom);
    },
    [minZoom, maxZoom, canvasRef, setZoom, setPan]
  );

  // --- Zoom controls ---
  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(z * 1.2, maxZoom)),
    [maxZoom, setZoom]
  );

  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(z / 1.2, minZoom)),
    [minZoom, setZoom]
  );

  const resetView = useCallback(() => {
    if (isControlledRef.current && onViewportChangeRef.current) {
      onViewportChangeRef.current({ zoom: 1, panX: 0, panY: 0 });
    } else {
      setInternalZoom(1);
      setInternalPan({ x: 0, y: 0 });
    }
  }, []);

  // --- Fit to content ---
  const computeFit = useCallback(() => {
    const container = containerRef?.current;
    const size = contentSize;
    if (!container || !size || size.width === 0 || size.height === 0) {
      return null;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const availableWidth = containerWidth - fitPadding * 2;
    const availableHeight = containerHeight - fitPadding * 2;

    const scaleX = availableWidth / size.width;
    const scaleY = availableHeight / size.height;
    const fitZoom = Math.min(scaleX, scaleY, 1); // Never upscale

    const centeredPan: ViewportPoint = {
      x: (containerWidth - size.width * fitZoom) / 2,
      y: (containerHeight - size.height * fitZoom) / 2,
    };

    return { fitZoom, centeredPan };
  }, [containerRef, contentSize, fitPadding]);

  // Keep fitToContent in a ref so auto-fit can call the latest version
  const fitToContentRef = useRef<() => void>(() => {});

  useEffect(() => {
    fitToContentRef.current = () => {
      const result = computeFit();
      if (!result) return;
      setZoom(result.fitZoom);
      setPan(result.centeredPan);
    };
  }, [computeFit, setZoom, setPan]);

  const fitToContent = useCallback(() => {
    fitToContentRef.current();
  }, []);

  // --- Auto-fit on mount / content change ---
  const autoFitDoneForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoFit || !contentSize || contentSize.width === 0) return;

    const key = `${contentSize.width}x${contentSize.height}`;
    if (autoFitDoneForRef.current === key) return;
    autoFitDoneForRef.current = key;

    // Use setTimeout(0) to ensure container has been laid out
    setTimeout(() => {
      const currentZoom = zoomRef.current;
      // Only auto-fit if zoom hasn't been changed from default
      if (currentZoom === 1) {
        fitToContentRef.current();
      }
    }, 0);
  }, [autoFit, contentSize]);

  // --- Mouse drag panning ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enableMousePan) return;
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    },
    [enableMousePan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enableMousePan || !isPanning || !dragStart) return;
      setPan((prev) => ({
        x: prev.x + (e.clientX - dragStart.x),
        y: prev.y + (e.clientY - dragStart.y),
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    },
    [enableMousePan, isPanning, dragStart, setPan]
  );

  const handleMouseUp = useCallback(() => {
    if (!enableMousePan) return;
    setIsPanning(false);
    setDragStart(null);
  }, [enableMousePan]);

  return {
    zoom,
    pan,
    isPanning,
    setZoom,
    setPan,
    screenToImage,
    imageToScreen,
    handleWheel,
    zoomIn,
    zoomOut,
    resetView,
    fitToContent,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
