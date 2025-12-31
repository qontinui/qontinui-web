"use client";

/**
 * Transition Animation Canvas
 *
 * Visualizes transition execution with animated actions and state changes.
 * Shows origin states, animates workflow actions, then displays target states.
 *
 * Features:
 * - Zoom constraints that prevent zooming out beyond visible monitors
 * - Grey area outside monitor boundaries
 * - Monitor filter (all monitors vs only monitors with elements)
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import type {
  Transition,
  State,
  ImageAsset,
} from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { Monitor } from "@/lib/schemas/geometry";
import {
  useTransitionAnimation,
  type UseTransitionAnimationResult,
} from "./TransitionAnimationController";
import { renderActionAnimation } from "./ActionAnimations";
import type {
  TransitionAnimationState,
  ActionAnimationConfig,
} from "@/types/transition-animation";
import {
  useMonitorCanvas,
  drawMonitorBackground,
  DARK_THEME,
  type MonitorCanvasBounds,
} from "./useMonitorCanvas";
import { MonitorFilter } from "./MonitorFilter";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Layers, Play } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface TransitionAnimationCanvasProps {
  /** The transition to visualize (null = show empty state) */
  transition: Transition | null;
  /** All states in the project */
  states: State[];
  /** All workflows in the project */
  workflows: Workflow[];
  /** All images in the project */
  images: ImageAsset[];
  /** Monitor info for multi-monitor coordinate handling */
  monitors?: Monitor[];
  /** Additional class names */
  className?: string;
  /** Animation controller (if provided externally) */
  animation?: UseTransitionAnimationResult;
  /** @deprecated Use animation prop instead - Ref to expose animation controls */
  controllerRef?: React.MutableRefObject<UseTransitionAnimationResult | null>;
  /** Whether to show the monitor filter UI (default: true) */
  showMonitorFilter?: boolean;
}

// Default canvas dimensions
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

// State colors for visualization
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

// ============================================================================
// Component
// ============================================================================

export function TransitionAnimationCanvas({
  transition,
  states,
  workflows,
  images,
  monitors = [],
  className,
  animation: externalAnimation,
  controllerRef,
  showMonitorFilter = true,
}: TransitionAnimationCanvasProps) {
  // Animation controller - use external if provided, otherwise create our own
  const internalAnimation = useTransitionAnimation();
  const animation = externalAnimation ?? internalAnimation;

  // Expose controller via ref (deprecated - for backward compatibility)
  useEffect(() => {
    if (controllerRef) {
      controllerRef.current = animation;
    }
  }, [animation, controllerRef]);

  // Monitor filter state - default to showing only monitors with elements
  const [showOnlyWithElements, setShowOnlyWithElements] = useState(true);

  // Calculate which monitors have elements (states with positioned images)
  const monitorsWithElements = useMemo(() => {
    const monitorIndices = new Set<number>();
    const data = animation.data;

    if (!data) return [];

    // Check origin and target states for positioned images
    const allStates = [...data.originStates, ...data.targetStates];
    allStates.forEach((state) => {
      state.stateImages?.forEach((stateImage) => {
        // Get the monitor index for this image
        const monitorIndex = stateImage.monitors?.[0] ?? 0;
        // Check if image has positioned patterns
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
  }, [animation.data, monitors]);

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

  // Loaded images cache
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  // Load transition when it changes
  useEffect(() => {
    if (transition) {
      animation.loadTransition(transition, states, workflows, monitors);
    } else {
      animation.cancel();
    }
  }, [transition?.id, monitors]); // Only reload when transition ID or monitors change

  // Build map of imageId -> loaded HTMLImageElement
  const getImageUrl = useCallback(
    (imageId: string): string | undefined => {
      const asset = images.find((img) => img.id === imageId);
      return asset?.url;
    },
    [images]
  );

  // Collect all image IDs needed for current states
  const neededImageIds = useMemo(() => {
    const ids = new Set<string>();
    const data = animation.data;

    if (!data) return ids;

    // Collect from origin and target states
    const allStates = [...data.originStates, ...data.targetStates];

    for (const state of allStates) {
      for (const stateImage of state.stateImages || []) {
        for (const pattern of stateImage.patterns || []) {
          if (pattern.imageId) {
            ids.add(pattern.imageId);
          }
        }
      }
    }

    return ids;
  }, [animation.data]);

  // Load images as needed
  useEffect(() => {
    for (const imageId of neededImageIds) {
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
    }
  }, [neededImageIds, getImageUrl, loadedImages]);

  // Canvas rendering
  useEffect(() => {
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

    // Apply transforms
    ctx.save();

    // Scale for high DPI displays
    ctx.scale(dpr, dpr);

    // Apply pan and zoom
    ctx.translate(canvas.pan.x, canvas.pan.y);
    ctx.scale(canvas.zoom, canvas.zoom);

    // Draw background with grey area outside monitors (using dark theme)
    drawMonitorBackground(
      ctx,
      canvas.bounds,
      canvas.displayedMonitors,
      DARK_THEME
    );

    // Get animation data
    const data = animation.data;
    const state = animation.state;

    // Debug: Log every render during executing-action phase
    if (
      process.env.NODE_ENV === "development" &&
      state.phase === "executing-action"
    ) {
      console.log(
        "[TransitionAnimation] Canvas RENDER during executing-action:",
        {
          phase: state.phase,
          progress: state.progress,
          globalActionIndex: state.globalActionIndex,
          currentAction: animation.currentAction?.type,
          currentActionName: animation.currentAction?.name,
        }
      );
    }

    if (!data) {
      // No transition loaded - show placeholder
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[TransitionAnimation] Canvas: rendering with no data (showing placeholder)",
          {
            phase: state.phase,
            hasTransition: !!transition,
          }
        );
      }
      drawPlaceholder(ctx, canvas.bounds);
    } else {
      // Draw states based on animation phase
      drawStates(ctx, data, state, loadedImages, canvas.bounds, monitors);

      // Draw current action animation if in executing phase
      if (state.phase === "executing-action") {
        const currentAction = animation.currentAction;
        if (!currentAction) {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              "[TransitionAnimation] Canvas: executing-action phase but no currentAction",
              {
                phase: state.phase,
                globalActionIndex: state.globalActionIndex,
                totalActions: state.totalActions,
                dataExists: !!data,
                sequenceLength: data?.actionSequence?.length ?? 0,
              }
            );
          }
        }
        if (currentAction) {
          const canvasCenter = {
            x: canvas.bounds.width / 2,
            y: canvas.bounds.height / 2,
          };

          // Transform action coordinates from absolute screen coordinates
          // to canvas coordinates (relative to bounds)
          const transformedAction = transformActionCoordinates(
            currentAction,
            canvas.bounds
          );

          renderActionAnimation(
            ctx,
            transformedAction,
            state.progress,
            canvasCenter
          );
        }
      }

      // Draw phase indicator
      drawPhaseIndicator(ctx, state, canvas.bounds);
    }

    ctx.restore();
  }, [
    animation.state,
    animation.data,
    animation.currentAction,
    canvas.pan,
    canvas.zoom,
    canvas.bounds,
    canvas.containerSize,
    canvas.displayedMonitors,
    loadedImages,
    monitors,
  ]);

  return (
    <div
      ref={canvas.containerRef}
      className={cn(
        "relative overflow-hidden bg-zinc-900 rounded-lg",
        className
      )}
      onMouseDown={canvas.handleMouseDown}
      onMouseMove={canvas.handleMouseMove}
      onMouseUp={canvas.handleMouseUp}
      onMouseLeave={canvas.handleMouseUp}
      style={{ cursor: canvas.isPanning ? "grabbing" : "grab" }}
    >
      <canvas
        ref={canvas.canvasRef}
        className="absolute inset-0 w-full h-full"
      />

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

      {/* Zoom controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <Button
          size="sm"
          variant="secondary"
          onClick={canvas.handleZoomIn}
          className="h-8 w-8 p-0"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={canvas.handleZoomOut}
          className="h-8 w-8 p-0"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={canvas.handleFitView}
          className="h-8 w-8 p-0"
          title="Fit to View"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <div className="text-xs text-center text-zinc-400 px-1">
          {Math.round(canvas.zoom * 100)}%
        </div>
      </div>

      {/* Legend */}
      {animation.data && <StateLegend data={animation.data} />}

      {/* Current action indicator */}
      {animation.state.phase === "executing-action" &&
        animation.currentAction && (
          <div className="absolute top-14 left-4 bg-black/80 rounded-lg p-3 z-10">
            <div className="text-xs font-semibold text-cyan-400 flex items-center gap-2">
              <Play className="h-3 w-3" />
              {animation.currentAction.name}
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              Action {animation.state.globalActionIndex + 1} of{" "}
              {animation.state.totalActions}
            </div>
          </div>
        )}
    </div>
  );
}

// ============================================================================
// Coordinate Transformation
// ============================================================================

/**
 * Transform action coordinates from absolute screen coordinates to canvas coordinates.
 * Action coordinates are stored as absolute screen coordinates (matching monitor layout),
 * but the canvas renders relative to bounds.minX/minY, so we need to subtract those.
 */
function transformActionCoordinates(
  action: ActionAnimationConfig,
  bounds: MonitorCanvasBounds
): ActionAnimationConfig {
  const transformed = { ...action };

  // Transform startPosition if present
  if (action.startPosition) {
    transformed.startPosition = {
      x: action.startPosition.x - bounds.minX,
      y: action.startPosition.y - bounds.minY,
    };
  }

  // Transform endPosition if present
  if (action.endPosition) {
    transformed.endPosition = {
      x: action.endPosition.x - bounds.minX,
      y: action.endPosition.y - bounds.minY,
    };
  }

  // Transform targetRegion if present
  if (action.targetRegion) {
    transformed.targetRegion = {
      x: action.targetRegion.x - bounds.minX,
      y: action.targetRegion.y - bounds.minY,
      width: action.targetRegion.width,
      height: action.targetRegion.height,
    };
  }

  return transformed;
}

// ============================================================================
// Drawing Functions
// ============================================================================

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  dimensions: { width: number; height: number }
): void {
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#71717a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    "Select a transition to visualize",
    dimensions.width / 2,
    dimensions.height / 2
  );
}

function drawStates(
  ctx: CanvasRenderingContext2D,
  data: NonNullable<UseTransitionAnimationResult["data"]>,
  state: TransitionAnimationState,
  loadedImages: Map<string, HTMLImageElement>,
  bounds: MonitorCanvasBounds,
  monitors: Monitor[]
): void {
  // Build set of target state IDs for quick lookup
  const targetStateIds = new Set(data.targetStates.map((s) => s.id));

  // Determine which states to show and their opacity based on phase
  let originOpacity = 1;
  let targetOpacity = 0;

  switch (state.phase) {
    case "idle":
    case "showing-initial":
      originOpacity = 1;
      targetOpacity = 0;
      break;
    case "executing-action":
      originOpacity = 1;
      targetOpacity = 0;
      break;
    case "transitioning-states":
      originOpacity = 1 - state.progress;
      targetOpacity = state.progress;
      break;
    case "showing-final":
    case "completed":
      originOpacity = 0;
      targetOpacity = 1;
      break;
  }

  // Draw origin states
  // States that "staysVisible" (in both origin and target) should remain at full opacity
  data.originStates.forEach((stateObj, index) => {
    const staysVisible = targetStateIds.has(stateObj.id);
    // If this state staysVisible, keep it at full opacity; otherwise use originOpacity
    const opacity = staysVisible ? 1 : originOpacity;

    // Debug: Log staysVisible check during final phases
    if (
      process.env.NODE_ENV === "development" &&
      (state.phase === "showing-final" || state.phase === "completed")
    ) {
      console.log("[TransitionAnimation] drawStates: origin state visibility", {
        stateName: stateObj.name,
        stateId: stateObj.id,
        phase: state.phase,
        staysVisible,
        originOpacity,
        finalOpacity: opacity,
        targetStateIds: Array.from(targetStateIds),
        isInTargetStates: targetStateIds.has(stateObj.id),
      });
    }

    if (opacity > 0) {
      drawState(
        ctx,
        stateObj,
        getStateColor(index),
        loadedImages,
        bounds,
        opacity,
        false,
        monitors
      );
    }
  });

  // Draw target states (fading in during transition)
  // Skip states that are also origin states (they were already drawn above)
  if (targetOpacity > 0) {
    const originStateIds = new Set(data.originStates.map((s) => s.id));

    data.targetStates.forEach((stateObj, index) => {
      // Skip if it's also an origin state (already drawn with staysVisible logic)
      if (originStateIds.has(stateObj.id)) return;

      drawState(
        ctx,
        stateObj,
        getStateColor(index + data.originStates.length),
        loadedImages,
        bounds,
        targetOpacity,
        true,
        monitors
      );
    });
  }
}

function drawState(
  ctx: CanvasRenderingContext2D,
  state: State,
  color: { border: string; bg: string },
  loadedImages: Map<string, HTMLImageElement>,
  bounds: MonitorCanvasBounds,
  opacity: number,
  isTarget: boolean,
  monitors: Monitor[]
): void {
  ctx.globalAlpha = opacity;

  // Build monitor map for coordinate translation
  const monitorMap = new Map<number, Monitor>();
  monitors.forEach((m) => monitorMap.set(m.index, m));

  // Draw state images
  for (const stateImage of state.stateImages || []) {
    // Get the monitor this image belongs to
    const monitorIndex = stateImage.monitors?.[0] ?? 0;
    const monitor = monitorMap.get(monitorIndex);

    for (const pattern of stateImage.patterns || []) {
      const imageId = pattern.imageId;
      if (!imageId) continue;

      const img = loadedImages.get(imageId);
      if (!img) continue;

      // Get position - try searchRegions first, then fallback to offsetX/offsetY
      // Note: offsetX/offsetY are technically click offsets, but some legacy data
      // may store actual position there. searchRegions is the correct source.
      let x = 0,
        y = 0;
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (pattern.searchRegions?.[0]) {
        // searchRegion coordinates are RELATIVE to the monitor they were captured on
        const sr = pattern.searchRegions[0];
        const absX = monitor ? monitor.x + sr.x : sr.x;
        const absY = monitor ? monitor.y + sr.y : sr.y;
        x = absX - bounds.minX;
        y = absY - bounds.minY;
        width = sr.width || width;
        height = sr.height || height;
      } else if (
        pattern.offsetX !== undefined &&
        pattern.offsetY !== undefined
      ) {
        // Fallback: use offsetX/offsetY (legacy data may store position here)
        const absX = monitor ? monitor.x + pattern.offsetX : pattern.offsetX;
        const absY = monitor ? monitor.y + pattern.offsetY : pattern.offsetY;
        x = absX - bounds.minX;
        y = absY - bounds.minY;
      }

      // Draw image
      ctx.drawImage(img, x, y, width, height);

      // Draw border
      ctx.strokeStyle = color.border;
      ctx.lineWidth = isTarget ? 3 : 2;
      if (isTarget) {
        ctx.setLineDash([8, 4]);
      }
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);

      // Draw label
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = color.border;
      const label = `${state.name}: ${stateImage.name || "Image"}`;
      const labelWidth = ctx.measureText(label).width + 8;

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(x, y - 18, labelWidth, 16);

      ctx.fillStyle = color.border;
      ctx.fillText(label, x + 4, y - 6);
    }
  }

  // Draw regions
  for (const region of state.regions || []) {
    const x = (region.x || 0) - bounds.minX;
    const y = (region.y || 0) - bounds.minY;
    const width = region.width || 100;
    const height = region.height || 100;

    ctx.fillStyle = color.bg;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = color.border;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
  }

  // Draw locations
  for (const location of state.locations || []) {
    const x = (location.x || 0) - bounds.minX;
    const y = (location.y || 0) - bounds.minY;

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color.border;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color.border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawPhaseIndicator(
  ctx: CanvasRenderingContext2D,
  state: TransitionAnimationState,
  dimensions: { width: number; height: number }
): void {
  let label = "";

  switch (state.phase) {
    case "idle":
      return; // No indicator needed
    case "showing-initial":
      label = "Initial State";
      break;
    case "executing-action":
      return; // Handled by overlay
    case "transitioning-states":
      label = "State Transition...";
      break;
    case "showing-final":
      label = "Final State";
      break;
    case "completed":
      label = "Complete";
      break;
  }

  if (!label) return;

  // Draw phase label at top center
  ctx.font = "bold 14px sans-serif";
  const textWidth = ctx.measureText(label).width;

  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(
    dimensions.width / 2 - textWidth / 2 - 12,
    10,
    textWidth + 24,
    28
  );

  ctx.fillStyle = state.phase === "completed" ? "#22c55e" : "#00d9ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, dimensions.width / 2, 24);
}

// Helper function to safely get state color
function getStateColor(index: number): { border: string; bg: string } {
  const color = STATE_COLORS[index % STATE_COLORS.length];
  return color ?? { border: "#ffffff", bg: "rgba(255, 255, 255, 0.2)" };
}

// StateLegend component (extracted to avoid closure issues)
function StateLegend({
  data,
}: {
  data: NonNullable<UseTransitionAnimationResult["data"]>;
}) {
  const originOriginStateIds = new Set(data.originStates.map((s) => s.id));
  const targetStatesNotInOrigin = data.activatedStates.filter(
    (s) => !originOriginStateIds.has(s.id)
  );

  return (
    <div className="absolute bottom-4 left-4 bg-black/80 rounded-lg p-3 z-10 max-w-xs">
      <div className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
        <Layers className="h-3 w-3" />
        States
      </div>
      <div className="space-y-1">
        {data.originStates.map((state, i) => (
          <div key={state.id} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: getStateColor(i).border }}
            />
            <span className="text-zinc-300">{state.name}</span>
            <span className="text-zinc-500">(origin)</span>
          </div>
        ))}
        {targetStatesNotInOrigin.map((state, i) => (
          <div key={state.id} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded border-2 border-dashed"
              style={{
                borderColor: getStateColor(i + data.originStates.length).border,
              }}
            />
            <span className="text-zinc-300">{state.name}</span>
            <span className="text-zinc-500">(target)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TransitionAnimationCanvas;
