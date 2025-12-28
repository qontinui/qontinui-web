"use client";

/**
 * Transition Animation Canvas
 *
 * Visualizes transition execution with animated actions and state changes.
 * Shows origin states, animates workflow actions, then displays target states.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import type {
  Transition,
  State,
  ImageAsset,
} from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { RunnerMonitor } from "@/lib/runner-client";
import {
  useTransitionAnimation,
  type UseTransitionAnimationResult,
} from "./TransitionAnimationController";
import { renderActionAnimation } from "./ActionAnimations";
import type { TransitionAnimationState } from "@/types/transition-animation";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Layers, Play } from "lucide-react";
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
  monitors?: RunnerMonitor[];
  /** Additional class names */
  className?: string;
  /** Ref to expose animation controls */
  controllerRef?: React.MutableRefObject<UseTransitionAnimationResult | null>;
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
  controllerRef,
}: TransitionAnimationCanvasProps) {
  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animation controller
  const animation = useTransitionAnimation();

  // Expose controller via ref
  useEffect(() => {
    if (controllerRef) {
      controllerRef.current = animation;
    }
  }, [animation, controllerRef]);

  // View state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Loaded images cache
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  // Load transition when it changes
  useEffect(() => {
    if (transition) {
      animation.loadTransition(transition, states, workflows);
    } else {
      animation.cancel();
    }
  }, [transition?.id]); // Only reload when transition ID changes

  // Calculate canvas dimensions from monitors or content
  const canvasDimensions = useMemo(() => {
    if (monitors.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      monitors.forEach((m) => {
        minX = Math.min(minX, m.x);
        minY = Math.min(minY, m.y);
        maxX = Math.max(maxX, m.x + m.width);
        maxY = Math.max(maxY, m.y + m.height);
      });

      return {
        width: maxX - minX || DEFAULT_WIDTH,
        height: maxY - minY || DEFAULT_HEIGHT,
        offsetX: minX,
        offsetY: minY,
      };
    }

    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      offsetX: 0,
      offsetY: 0,
    };
  }, [monitors]);

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

  // Auto-fit view on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;

    const scaleX = containerWidth / canvasDimensions.width;
    const scaleY = containerHeight / canvasDimensions.height;
    const scale = Math.min(scaleX, scaleY, 1) * 0.9;

    setZoom(scale);
    setPan({
      x: (containerWidth - canvasDimensions.width * scale) / 2,
      y: (containerHeight - canvasDimensions.height * scale) / 2,
    });
  }, [canvasDimensions]);

  // Zoom handlers
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 5));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.25, 0.1));

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.1, Math.min(5, z * delta)));
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply transforms
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw background
    drawBackground(ctx, canvasDimensions, monitors);

    // Get animation data
    const data = animation.data;
    const state = animation.state;

    if (!data) {
      // No transition loaded - show placeholder
      drawPlaceholder(ctx, canvasDimensions);
    } else {
      // Draw states based on animation phase
      drawStates(ctx, data, state, loadedImages, canvasDimensions);

      // Draw current action animation if in executing phase
      if (state.phase === "executing-action") {
        const currentAction = animation.currentAction;
        if (currentAction) {
          const canvasCenter = {
            x: canvasDimensions.width / 2,
            y: canvasDimensions.height / 2,
          };
          renderActionAnimation(
            ctx,
            currentAction,
            state.progress,
            canvasCenter
          );
        }
      }

      // Draw phase indicator
      drawPhaseIndicator(ctx, state, canvasDimensions);
    }

    ctx.restore();
  }, [
    animation.state,
    animation.data,
    animation.currentAction,
    pan,
    zoom,
    loadedImages,
    canvasDimensions,
    monitors,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden bg-zinc-900 rounded-lg",
        className
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isPanning ? "grabbing" : "grab" }}
    >
      <canvas
        ref={canvasRef}
        width={canvasDimensions.width}
        height={canvasDimensions.height}
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      />

      {/* Zoom controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleZoomIn}
          className="h-8 w-8 p-0"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleZoomOut}
          className="h-8 w-8 p-0"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      {animation.data && <StateLegend data={animation.data} />}

      {/* Current action indicator */}
      {animation.state.phase === "executing-action" &&
        animation.currentAction && (
          <div className="absolute top-4 left-4 bg-black/80 rounded-lg p-3 z-10">
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
// Drawing Functions
// ============================================================================

function drawBackground(
  ctx: CanvasRenderingContext2D,
  dimensions: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  },
  monitors: RunnerMonitor[]
): void {
  // Fill with dark background
  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, 0, dimensions.width, dimensions.height);

  // Draw monitor backgrounds
  if (monitors.length > 0) {
    monitors.forEach((monitor) => {
      const x = monitor.x - dimensions.offsetX;
      const y = monitor.y - dimensions.offsetY;

      // Monitor background
      ctx.fillStyle = "#27272a";
      ctx.fillRect(x, y, monitor.width, monitor.height);

      // Monitor border
      ctx.strokeStyle = "#3f3f46";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, monitor.width, monitor.height);

      // Monitor label
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#71717a";
      ctx.fillText(`Monitor ${monitor.index}`, x + 10, y + 20);
    });
  } else {
    // Single default monitor
    ctx.fillStyle = "#27272a";
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, dimensions.width, dimensions.height);
  }

  // Draw grid
  ctx.strokeStyle = "#3f3f4610";
  ctx.lineWidth = 1;
  const gridSize = 50;

  for (let x = 0; x < dimensions.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, dimensions.height);
    ctx.stroke();
  }

  for (let y = 0; y < dimensions.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(dimensions.width, y);
    ctx.stroke();
  }
}

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
  dimensions: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  }
): void {
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

  // Draw origin states (fading out during transition)
  if (originOpacity > 0) {
    data.originStates.forEach((stateObj, index) => {
      drawState(
        ctx,
        stateObj,
        getStateColor(index),
        loadedImages,
        dimensions,
        originOpacity,
        false
      );
    });
  }

  // Draw target states (fading in during transition)
  if (targetOpacity > 0) {
    data.targetStates.forEach((stateObj, index) => {
      // Skip if it's also an origin state (staysVisible)
      if (data.originStates.find((o) => o.id === stateObj.id)) return;

      drawState(
        ctx,
        stateObj,
        getStateColor(index + data.originStates.length),
        loadedImages,
        dimensions,
        targetOpacity,
        true
      );
    });
  }
}

function drawState(
  ctx: CanvasRenderingContext2D,
  state: State,
  color: { border: string; bg: string },
  loadedImages: Map<string, HTMLImageElement>,
  dimensions: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  },
  opacity: number,
  isTarget: boolean
): void {
  ctx.globalAlpha = opacity;

  // Draw state images
  for (const stateImage of state.stateImages || []) {
    for (const pattern of stateImage.patterns || []) {
      const imageId = pattern.imageId;
      if (!imageId) continue;

      const img = loadedImages.get(imageId);
      if (!img) continue;

      // Get position
      let x = 0,
        y = 0;
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (pattern.offsetX !== undefined && pattern.offsetY !== undefined) {
        x = pattern.offsetX - dimensions.offsetX;
        y = pattern.offsetY - dimensions.offsetY;
      } else if (pattern.searchRegions?.[0]) {
        const sr = pattern.searchRegions[0];
        x = sr.x - dimensions.offsetX;
        y = sr.y - dimensions.offsetY;
        width = sr.width || width;
        height = sr.height || height;
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
    const x = (region.x || 0) - dimensions.offsetX;
    const y = (region.y || 0) - dimensions.offsetY;
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
    const x = (location.x || 0) - dimensions.offsetX;
    const y = (location.y || 0) - dimensions.offsetY;

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
