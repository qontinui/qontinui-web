/**
 * Active States Canvas - Dual-Mode Rendering
 *
 * Supports two modes:
 *
 * 1. PERCEPTION MODE (default): Shows what the automation "sees" during execution
 *    - Only found images appear on the canvas (at their detected coordinates)
 *    - Active states are shown as a text legend with color coding
 *    - When states are deactivated, their elements disappear from the canvas
 *    - Color coding links state names to their image borders
 *
 * 2. CONFIG MODE: Shows static configuration positions
 *    - Images are shown at their configured positions (offsetX/offsetY or searchRegions)
 *    - Useful for previewing state elements without running automation
 *    - Supports highlightStateId to emphasize a specific state
 *
 * Features:
 * - Zoom constraints that prevent zooming out beyond visible monitors
 * - Grey area outside monitor boundaries
 * - Monitor filter (all monitors vs only monitors with elements)
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import type { Monitor } from "@/lib/schemas/geometry";
import type {
  ImageRecognitionEvent,
  ConnectionState,
} from "@/hooks/useExecutionEvents";
import {
  useMonitorCanvas,
  drawMonitorBackground,
  DEFAULT_THEME,
} from "./useMonitorCanvas";
import { MonitorFilter } from "./MonitorFilter";
import { Button } from "@/components/ui/button";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Wifi,
  WifiOff,
  Radio,
  Eye,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  GripVertical,
  Move,
} from "lucide-react";
import { cn } from "@/lib/utils";

type CanvasMode = "perception" | "config";

interface ActiveStatesCanvasProps {
  /** All states in the project (used to look up state info) */
  states: State[];
  /** All images in the project (used to load image assets) */
  images: ImageAsset[];
  /** Monitor info for multi-monitor coordinate handling */
  monitors?: Monitor[];
  /** Rendering mode: 'perception' for live execution, 'config' for static preview */
  mode?: CanvasMode;
  /** Currently active state IDs (for perception mode, required) */
  activeStateIds?: Set<string> | string[];
  /** Map of imageId to recognition events with found coordinates (perception mode) */
  foundImages?: Map<string, ImageRecognitionEvent>;
  /** Connection state for live mode indicator (perception mode) */
  connectionState?: ConnectionState;
  /** State ID to highlight (config mode only) */
  highlightStateId?: string;
  className?: string;
  /** Whether to show the monitor filter UI (default: true) */
  showMonitorFilter?: boolean;
}

// Default canvas dimensions (single monitor fallback)
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

// Distinct colors for states - solid colors for borders and text
const STATE_COLORS = [
  { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)", name: "blue" },
  { border: "#22c55e", bg: "rgba(34, 197, 94, 0.15)", name: "green" },
  { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", name: "amber" },
  { border: "#ec4899", bg: "rgba(236, 72, 153, 0.15)", name: "pink" },
  { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.15)", name: "purple" },
  { border: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", name: "red" },
  { border: "#06b6d4", bg: "rgba(6, 182, 212, 0.15)", name: "cyan" },
  { border: "#84cc16", bg: "rgba(132, 204, 22, 0.15)", name: "lime" },
];

// Build a map of imageId -> stateId for quick lookups
function buildImageToStateMap(
  states: State[]
): Map<string, { stateId: string; stateName: string; imageLabel: string }> {
  const map = new Map<
    string,
    { stateId: string; stateName: string; imageLabel: string }
  >();

  states.forEach((state) => {
    state.stateImages?.forEach((stateImage) => {
      stateImage.patterns?.forEach((pattern) => {
        if (pattern.imageId) {
          map.set(pattern.imageId, {
            stateId: state.id,
            stateName: state.name,
            imageLabel: stateImage.name || pattern.name || "Image",
          });
        }
      });
    });
  });

  return map;
}

export function ActiveStatesCanvas({
  states,
  images,
  monitors = [],
  mode = "perception",
  activeStateIds,
  foundImages,
  connectionState,
  highlightStateId,
  className = "",
  showMonitorFilter = true,
}: ActiveStatesCanvasProps) {
  // Monitor filter state
  const [showOnlyWithElements, setShowOnlyWithElements] = useState(false);

  // Legend collapse and floating/draggable state
  const [isLegendCollapsed, setIsLegendCollapsed] = useState(false);
  const [isLegendFloating, setIsLegendFloating] = useState(false);
  const [legendPosition, setLegendPosition] = useState({ x: 16, y: 16 });
  const legendDragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  // Legend drag handler for floating mode
  const handleLegendDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isLegendFloating) return;
      e.preventDefault();
      e.stopPropagation();
      legendDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: legendPosition.x,
        initialY: legendPosition.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!legendDragRef.current) return;
        const deltaX = moveEvent.clientX - legendDragRef.current.startX;
        const deltaY = moveEvent.clientY - legendDragRef.current.startY;
        setLegendPosition({
          x: legendDragRef.current.initialX + deltaX,
          y: legendDragRef.current.initialY + deltaY,
        });
      };

      const handleMouseUp = () => {
        legendDragRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isLegendFloating, legendPosition]
  );

  // Normalize activeStateIds to a Set
  const activeStateIdsSet = useMemo(() => {
    if (!activeStateIds) {
      // In config mode, treat all provided states as "active"
      if (mode === "config") {
        return new Set(states.map((s) => s.id));
      }
      return new Set<string>();
    }
    return activeStateIds instanceof Set
      ? activeStateIds
      : new Set(activeStateIds);
  }, [activeStateIds, mode, states]);

  // Build image -> state mapping
  const imageToStateMap = useMemo(() => buildImageToStateMap(states), [states]);

  // State color type
  type StateColor = (typeof STATE_COLORS)[0];

  // Assign colors to active states
  const stateColorMap = useMemo(() => {
    const map = new Map<string, StateColor>();
    let colorIndex = 0;

    activeStateIdsSet.forEach((stateId) => {
      const color = STATE_COLORS[colorIndex % STATE_COLORS.length];
      if (color) {
        map.set(stateId, color);
      }
      colorIndex++;
    });

    return map;
  }, [activeStateIdsSet]);

  // Default color for fallback (STATE_COLORS always has at least one element)
  const defaultColor: StateColor = STATE_COLORS[0]!;

  // Get active states with their info
  const activeStatesInfo = useMemo(() => {
    return Array.from(activeStateIdsSet).map((stateId) => {
      const state = states.find((s) => s.id === stateId);
      const color = stateColorMap.get(stateId) ?? defaultColor;
      return {
        id: stateId,
        name: state?.name || stateId,
        color,
      };
    });
  }, [activeStateIdsSet, states, stateColorMap, defaultColor]);

  // Filter found images to only those belonging to active states (perception mode)
  const visibleFoundImages = useMemo(() => {
    if (mode !== "perception" || !foundImages) return [];

    const result: Array<{
      imageId: string;
      recognition: ImageRecognitionEvent;
      stateId: string;
      stateName: string;
      imageLabel: string;
      color: (typeof STATE_COLORS)[0];
    }> = [];

    foundImages.forEach((recognition, imageId) => {
      if (!recognition.found || recognition.x === undefined) return;

      const stateInfo = imageToStateMap.get(imageId);
      if (!stateInfo) return;

      // Only show if the parent state is active
      if (!activeStateIdsSet.has(stateInfo.stateId)) return;

      const color = stateColorMap.get(stateInfo.stateId) ?? defaultColor;

      result.push({
        imageId,
        recognition,
        stateId: stateInfo.stateId,
        stateName: stateInfo.stateName,
        imageLabel: stateInfo.imageLabel,
        color,
      });
    });

    return result;
  }, [
    mode,
    foundImages,
    imageToStateMap,
    activeStateIdsSet,
    stateColorMap,
    defaultColor,
  ]);

  // Image cache - declared early so it can be used by stateBounds
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  // Build a map of monitor index to monitor info for coordinate translation
  const monitorMap = useMemo(() => {
    const map = new Map<number, Monitor>();
    monitors.forEach((m) => map.set(m.index, m));
    return map;
  }, [monitors]);

  // Calculate which monitors have elements (states with positioned images)
  const monitorsWithElements = useMemo(() => {
    const monitorIndices = new Set<number>();

    states.forEach((state) => {
      if (!activeStateIdsSet.has(state.id)) return;

      state.stateImages?.forEach((stateImage) => {
        const monitorIndex = stateImage.monitors?.[0] ?? 0;
        const hasPosition = stateImage.patterns?.some(
          (p) =>
            (p.offsetX !== undefined && p.offsetY !== undefined) ||
            p.searchRegions?.some(
              (sr) => sr.x !== undefined && sr.y !== undefined
            )
        );
        if (hasPosition) {
          monitorIndices.add(monitorIndex);
        }
      });
    });

    return Array.from(monitorIndices);
  }, [states, activeStateIdsSet]);

  // Use the shared monitor canvas hook
  const canvas = useMonitorCanvas({
    monitors,
    monitorsWithElements,
    showOnlyWithElements,
    maxZoom: 5,
    minFitZoom: 0.4, // Minimum 40% zoom to prevent very small display with multi-monitor
    defaultDimensions: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    pinToTop: true,
  });

  // Collect config-based image positions (config mode)
  // SearchRegion coordinates are stored RELATIVE to the monitor they were captured on
  // We need to translate them to absolute screen coordinates using the monitor position
  const configImages = useMemo(() => {
    if (mode !== "config") return [];

    const result: Array<{
      imageId: string;
      stateId: string;
      stateName: string;
      imageLabel: string;
      color: (typeof STATE_COLORS)[0];
      x: number;
      y: number;
      width?: number;
      height?: number;
      isHighlighted: boolean;
    }> = [];

    states.forEach((state) => {
      // Only include if this state is in the active set
      if (!activeStateIdsSet.has(state.id)) return;

      const color = stateColorMap.get(state.id) ?? defaultColor;
      const isHighlighted = state.id === highlightStateId;

      state.stateImages?.forEach((stateImage) => {
        // Get the monitor this image belongs to
        const monitorIndex = stateImage.monitors?.[0] ?? 0;
        const monitor = monitorMap.get(monitorIndex);

        stateImage.patterns?.forEach((pattern) => {
          if (!pattern.imageId) return;

          // Get position from offsetX/offsetY or searchRegion
          // These are stored RELATIVE to the monitor
          let relX: number | undefined;
          let relY: number | undefined;
          let width: number | undefined;
          let height: number | undefined;

          // First try offsetX/offsetY (found/saved position)
          if (pattern.offsetX !== undefined && pattern.offsetY !== undefined) {
            relX = pattern.offsetX;
            relY = pattern.offsetY;
          }
          // Fallback to first searchRegion position
          else if (pattern.searchRegions && pattern.searchRegions.length > 0) {
            const region = pattern.searchRegions[0];
            if (region && region.x !== undefined && region.y !== undefined) {
              relX = region.x;
              relY = region.y;
              width = region.width;
              height = region.height;
            }
          }

          if (relX !== undefined && relY !== undefined) {
            // Translate to absolute screen coordinates
            // If monitor info available, add monitor position; otherwise use as-is
            const absX = monitor ? monitor.x + relX : relX;
            const absY = monitor ? monitor.y + relY : relY;

            result.push({
              imageId: pattern.imageId,
              stateId: state.id,
              stateName: state.name,
              imageLabel: stateImage.name || pattern.name || "Image",
              color,
              x: absX,
              y: absY,
              width,
              height,
              isHighlighted,
            });
          }
        });
      });
    });

    return result;
  }, [
    mode,
    states,
    activeStateIdsSet,
    stateColorMap,
    highlightStateId,
    defaultColor,
    monitorMap,
  ]);

  // Calculate state bounds from configImages (for config mode background rendering)
  // Groups images by state and calculates bounding box for each state
  const stateBounds = useMemo(() => {
    if (mode !== "config" || configImages.length === 0) return [];

    // Group images by stateId
    const stateImageGroups = new Map<string, typeof configImages>();
    configImages.forEach((img) => {
      const group = stateImageGroups.get(img.stateId) || [];
      group.push(img);
      stateImageGroups.set(img.stateId, group);
    });

    // Calculate bounds for each state
    const bounds: Array<{
      stateId: string;
      stateName: string;
      color: (typeof STATE_COLORS)[0];
      x: number;
      y: number;
      width: number;
      height: number;
      isHighlighted: boolean;
    }> = [];

    stateImageGroups.forEach((images, stateId) => {
      if (images.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      images.forEach((img) => {
        // Get image dimensions from loaded images or use defaults
        const loadedImg = loadedImages.get(img.imageId);
        const w = img.width ?? loadedImg?.naturalWidth ?? 100;
        const h = img.height ?? loadedImg?.naturalHeight ?? 100;

        minX = Math.min(minX, img.x);
        minY = Math.min(minY, img.y);
        maxX = Math.max(maxX, img.x + w);
        maxY = Math.max(maxY, img.y + h);
      });

      // Add padding around the bounds
      const padding = 15;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;

      // firstImage is guaranteed to exist because we check images.length === 0 above
      const firstImage = images[0]!;
      bounds.push({
        stateId,
        stateName: firstImage.stateName,
        color: firstImage.color,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        isHighlighted: firstImage.isHighlighted,
      });
    });

    return bounds;
  }, [mode, configImages, loadedImages]);

  // Legacy alias for monitorOffset - used in image coordinate translation
  const monitorOffset = {
    x: canvas.bounds.offsetX,
    y: canvas.bounds.offsetY,
  };

  // Helper to get image URL
  const getImageUrl = useCallback(
    (imageId: string | undefined): string | null => {
      if (!imageId) return null;
      const imageAsset = images.find((img) => img.id === imageId);
      return imageAsset?.url || null;
    },
    [images]
  );

  // Load images for visible images (both modes)
  useEffect(() => {
    // Collect all image IDs to load based on mode
    const imageIdsToLoad =
      mode === "perception"
        ? visibleFoundImages.map(({ imageId }) => imageId)
        : configImages.map(({ imageId }) => imageId);

    imageIdsToLoad.forEach((imageId) => {
      if (!loadedImages.has(imageId)) {
        const url = getImageUrl(imageId);
        if (url) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            setLoadedImages((prev) => {
              const next = new Map(prev);
              next.set(imageId, img);
              return next;
            });
          };
          img.src = url;
        }
      }
    });
  }, [mode, visibleFoundImages, configImages, getImageUrl, loadedImages]);

  // Auto-fit is handled by the useMonitorCanvas hook

  // Redraw canvas
  const redraw = useCallback(() => {
    const canvasEl = canvas.canvasRef.current;
    if (!canvasEl) return;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    // Skip rendering if container hasn't been measured yet
    if (canvas.containerSize.width === 0 || canvas.containerSize.height === 0) {
      return;
    }

    // Set canvas size to container size (NOT bounds!)
    // The pan/zoom transforms are calculated based on containerSize,
    // so the canvas buffer must match for correct rendering.
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = canvas.containerSize.width * dpr;
    canvasEl.height = canvas.containerSize.height * dpr;

    // Clear canvas
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // Apply transformations
    ctx.save();

    // Scale for high DPI displays
    ctx.scale(dpr, dpr);

    // Apply pan and zoom
    ctx.translate(canvas.pan.x, canvas.pan.y);
    ctx.scale(canvas.zoom, canvas.zoom);

    // Draw monitor areas with grey outside (using shared function with light theme)
    drawMonitorBackground(
      ctx,
      canvas.bounds,
      canvas.displayedMonitors,
      DEFAULT_THEME
    );

    // Draw images based on mode
    if (mode === "perception") {
      // Draw only found images (at their found coordinates)
      visibleFoundImages.forEach(
        ({ imageId, recognition, color, imageLabel }) => {
          const loadedImg = loadedImages.get(imageId);
          if (!loadedImg) return;

          const x = (recognition.x ?? 0) + monitorOffset.x;
          const y = (recognition.y ?? 0) + monitorOffset.y;
          const w = recognition.width ?? loadedImg.naturalWidth;
          const h = recognition.height ?? loadedImg.naturalHeight;

          // Draw the image
          ctx.drawImage(loadedImg, x, y, w, h);

          // Draw colored border matching state color
          ctx.strokeStyle = color.border;
          ctx.lineWidth = 3;
          ctx.shadowColor = color.border;
          ctx.shadowBlur = 6;
          ctx.strokeRect(x, y, w, h);
          ctx.shadowBlur = 0;

          // Draw label with state color
          ctx.fillStyle = color.border;
          ctx.font = "bold 11px Arial";

          // Background for label
          const labelText = imageLabel;
          const labelWidth = ctx.measureText(labelText).width + 8;
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.fillRect(x, y - 18, labelWidth, 16);

          ctx.fillStyle = color.border;
          ctx.fillText(labelText, x + 4, y - 6);
        }
      );
    } else {
      // Config mode: Draw state backgrounds first, then images on top
      // Coordinates are now absolute screen coordinates (translated from monitor-relative)
      // We need to add monitorOffset to convert to canvas coordinates

      // Step 1: Draw state boundary backgrounds
      stateBounds.forEach(
        ({
          stateName,
          color,
          x: boundsX,
          y: boundsY,
          width: boundsW,
          height: boundsH,
          isHighlighted,
        }) => {
          // Add monitorOffset to translate from absolute screen coords to canvas coords
          const x = boundsX + monitorOffset.x;
          const y = boundsY + monitorOffset.y;

          // Draw background fill
          ctx.fillStyle = color.bg;
          ctx.fillRect(x, y, boundsW, boundsH);

          // Draw border
          ctx.strokeStyle = color.border;
          ctx.lineWidth = isHighlighted ? 3 : 2;
          ctx.globalAlpha = isHighlighted ? 1.0 : 0.6;
          if (isHighlighted) {
            ctx.shadowColor = color.border;
            ctx.shadowBlur = 8;
          }
          ctx.strokeRect(x, y, boundsW, boundsH);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1.0;

          // Draw state name label in top-left corner
          ctx.font = isHighlighted ? "bold 13px Arial" : "bold 12px Arial";
          const labelText = stateName;
          const labelWidth = ctx.measureText(labelText).width + 12;
          const labelHeight = 20;

          // Label background
          ctx.fillStyle = color.border;
          ctx.globalAlpha = isHighlighted ? 1.0 : 0.85;
          ctx.fillRect(x, y, labelWidth, labelHeight);
          ctx.globalAlpha = 1.0;

          // Label text
          ctx.fillStyle = "#ffffff";
          ctx.fillText(labelText, x + 6, y + 14);
        }
      );

      // Step 2: Draw images on top of state backgrounds
      configImages.forEach(
        ({
          imageId,
          color,
          imageLabel,
          x: imgX,
          y: imgY,
          width,
          height,
          isHighlighted,
        }) => {
          const loadedImg = loadedImages.get(imageId);
          if (!loadedImg) return;

          // Add monitorOffset to translate from absolute screen coords to canvas coords
          const x = imgX + monitorOffset.x;
          const y = imgY + monitorOffset.y;
          const w = width ?? loadedImg.naturalWidth;
          const h = height ?? loadedImg.naturalHeight;

          // Draw the image
          ctx.drawImage(loadedImg, x, y, w, h);

          // Draw colored border (thicker if highlighted)
          ctx.strokeStyle = color.border;
          ctx.lineWidth = isHighlighted ? 4 : 2;
          if (isHighlighted) {
            ctx.shadowColor = color.border;
            ctx.shadowBlur = 10;
          }
          ctx.strokeRect(x, y, w, h);
          ctx.shadowBlur = 0;

          // Draw image label
          ctx.font = isHighlighted ? "bold 11px Arial" : "10px Arial";
          const labelText = imageLabel;
          const labelWidth = ctx.measureText(labelText).width + 8;
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.fillRect(x, y - 16, labelWidth, 14);

          ctx.fillStyle = color.border;
          ctx.fillText(labelText, x + 4, y - 5);
        }
      );
    }

    ctx.restore();
  }, [
    mode,
    visibleFoundImages,
    configImages,
    stateBounds,
    canvas.zoom,
    canvas.pan,
    canvas.bounds,
    canvas.containerSize,
    canvas.displayedMonitors,
    loadedImages,
    monitorOffset,
  ]);

  // Redraw on changes
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Mouse and wheel handlers are provided by the useMonitorCanvas hook

  const isLiveMode = connectionState !== undefined;
  const hasFoundImages = visibleFoundImages.length > 0;
  const hasConfigImages = configImages.length > 0;
  const hasVisibleContent =
    mode === "perception" ? hasFoundImages : hasConfigImages;

  return (
    <div className={cn("relative flex flex-col h-full", className)}>
      {/* Legend - different for each mode */}
      {mode === "perception" ? (
        /* Perception mode: Active States Legend */
        <div
          className={cn(
            "absolute z-10 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg",
            isLegendFloating ? "border-2" : "",
            isLegendCollapsed ? "p-2" : "p-3",
            !isLegendFloating && "max-w-[280px]"
          )}
          style={
            isLegendFloating
              ? { left: legendPosition.x, top: legendPosition.y }
              : { left: 16, top: 16 }
          }
        >
          <div
            className={cn(
              "flex items-center gap-2",
              !isLegendCollapsed && "mb-2"
            )}
          >
            {isLegendFloating && (
              <div
                className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 hover:bg-muted rounded"
                onMouseDown={handleLegendDragStart}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Active States</span>
            {isLiveMode && !isLegendCollapsed && (
              <span className="ml-auto">
                {connectionState === "connected" ? (
                  <Radio className="h-3 w-3 text-green-500 animate-pulse" />
                ) : connectionState === "connecting" ||
                  connectionState === "reconnecting" ? (
                  <Wifi className="h-3 w-3 text-yellow-500 animate-pulse" />
                ) : (
                  <WifiOff className="h-3 w-3 text-muted-foreground" />
                )}
              </span>
            )}
            <div className="flex items-center gap-0.5 ml-auto">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setIsLegendFloating(!isLegendFloating)}
                title={isLegendFloating ? "Dock panel" : "Float panel"}
              >
                <Move className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setIsLegendCollapsed(!isLegendCollapsed)}
                title={isLegendCollapsed ? "Expand" : "Collapse"}
              >
                {isLegendCollapsed ? (
                  <PanelLeftOpen className="h-3 w-3" />
                ) : (
                  <PanelLeftClose className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {!isLegendCollapsed && (
            <>
              {activeStatesInfo.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active states
                </p>
              ) : (
                <div className="space-y-1.5">
                  {activeStatesInfo.map(({ id, name, color }) => {
                    // Count found images for this state
                    const foundCount = visibleFoundImages.filter(
                      (img) => img.stateId === id
                    ).length;

                    return (
                      <div key={id} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: color.border }}
                        />
                        <span className="text-xs truncate flex-1" title={name}>
                          {name}
                        </span>
                        {foundCount > 0 && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: color.bg,
                              color: color.border,
                              fontWeight: 500,
                            }}
                          >
                            {foundCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                {hasFoundImages
                  ? `${visibleFoundImages.length} image(s) found`
                  : "No images found yet"}
              </div>
            </>
          )}
        </div>
      ) : (
        /* Config mode: Selected States Legend */
        <div
          className={cn(
            "absolute z-10 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg",
            isLegendFloating ? "border-2" : "",
            isLegendCollapsed ? "p-2" : "p-3",
            !isLegendFloating && "max-w-[280px]"
          )}
          style={
            isLegendFloating
              ? { left: legendPosition.x, top: legendPosition.y }
              : { left: 16, top: 16 }
          }
        >
          <div
            className={cn(
              "flex items-center gap-2",
              !isLegendCollapsed && "mb-2"
            )}
          >
            {isLegendFloating && (
              <div
                className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 hover:bg-muted rounded"
                onMouseDown={handleLegendDragStart}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Selected States</span>
            <div className="flex items-center gap-0.5 ml-auto">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setIsLegendFloating(!isLegendFloating)}
                title={isLegendFloating ? "Dock panel" : "Float panel"}
              >
                <Move className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setIsLegendCollapsed(!isLegendCollapsed)}
                title={isLegendCollapsed ? "Expand" : "Collapse"}
              >
                {isLegendCollapsed ? (
                  <PanelLeftOpen className="h-3 w-3" />
                ) : (
                  <PanelLeftClose className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {!isLegendCollapsed && (
            <>
              {activeStatesInfo.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No states selected
                </p>
              ) : (
                <div className="space-y-1.5">
                  {activeStatesInfo.map(({ id, name, color }) => {
                    // Count config images for this state
                    const imageCount = configImages.filter(
                      (img) => img.stateId === id
                    ).length;
                    const isHighlighted = id === highlightStateId;

                    return (
                      <div
                        key={id}
                        className={cn(
                          "flex items-center gap-2",
                          isHighlighted && "font-medium"
                        )}
                      >
                        <div
                          className={cn(
                            "w-3 h-3 rounded-sm flex-shrink-0",
                            isHighlighted && "ring-2 ring-offset-1 ring-current"
                          )}
                          style={{ backgroundColor: color.border }}
                        />
                        <span className="text-xs truncate flex-1" title={name}>
                          {name}
                        </span>
                        {imageCount > 0 && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: color.bg,
                              color: color.border,
                              fontWeight: 500,
                            }}
                          >
                            {imageCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                {configImages.length} image(s) at configured positions
              </div>
            </>
          )}
        </div>
      )}

      {/* Monitor filter */}
      {showMonitorFilter && monitors.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <MonitorFilter
            showOnlyWithElements={showOnlyWithElements}
            onChange={setShowOnlyWithElements}
            totalMonitors={monitors.length}
            monitorsWithElements={monitorsWithElements.length}
          />
        </div>
      )}

      {/* Zoom Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-background/80 backdrop-blur-sm rounded-lg p-2 shadow-lg">
        <Button
          size="sm"
          variant="outline"
          onClick={canvas.handleZoomIn}
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={canvas.handleZoomOut}
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={canvas.handleFitView}
          title="Fit to View"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <div className="text-xs text-center text-muted-foreground px-2">
          {Math.round(canvas.zoom * 100)}%
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvas.containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border"
      >
        <canvas
          ref={canvas.canvasRef}
          style={{ cursor: canvas.isPanning ? "grabbing" : "grab" }}
          onMouseDown={canvas.handleMouseDown}
          onMouseMove={canvas.handleMouseMove}
          onMouseUp={canvas.handleMouseUp}
          onMouseLeave={canvas.handleMouseUp}
          className="w-full h-full"
        />

        {/* Empty state overlay - only for perception mode or config with no images */}
        {!hasVisibleContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-muted-foreground bg-background/80 backdrop-blur-sm rounded-lg p-6">
              {mode === "perception" ? (
                <>
                  <Eye className="mx-auto h-12 w-12 mb-2 opacity-50" />
                  <p className="font-medium">Perception Canvas</p>
                  <p className="text-xs mt-1">
                    Found images will appear here at their detected coordinates
                  </p>
                  {activeStatesInfo.length > 0 && (
                    <p className="text-xs mt-2 text-muted-foreground/70">
                      {activeStatesInfo.length} state(s) active, waiting for
                      image detection...
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Layers className="mx-auto h-12 w-12 mb-2 opacity-50" />
                  <p className="font-medium">No Elements to Display</p>
                  <p className="text-xs mt-1">
                    Select states with positioned elements to view
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 text-sm text-muted-foreground text-center">
        Drag to pan • Scroll to zoom •{" "}
        {mode === "perception"
          ? "Shows detected images"
          : "Shows configured positions"}
      </div>
    </div>
  );
}
