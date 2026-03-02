import type { State } from "@/contexts/automation-context/types";
import type { Monitor } from "@/lib/schemas/geometry";
import type { UseTransitionAnimationResult } from "./TransitionAnimationController";
import type {
  TransitionAnimationState,
  ActionAnimationConfig,
} from "@/types/transition-animation";
import type { MonitorCanvasBounds } from "./useMonitorCanvas";
import { STATE_COLORS } from "./TransitionAnimationCanvas-types";

export function getStateColor(index: number): { border: string; bg: string } {
  const color = STATE_COLORS[index % STATE_COLORS.length];
  return color ?? { border: "#ffffff", bg: "rgba(255, 255, 255, 0.2)" };
}

export function transformActionCoordinates(
  action: ActionAnimationConfig,
  bounds: MonitorCanvasBounds
): ActionAnimationConfig {
  const transformed = { ...action };

  if (action.startPosition) {
    transformed.startPosition = {
      x: action.startPosition.x - bounds.minX,
      y: action.startPosition.y - bounds.minY,
    };
  }

  if (action.endPosition) {
    transformed.endPosition = {
      x: action.endPosition.x - bounds.minX,
      y: action.endPosition.y - bounds.minY,
    };
  }

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

export function drawPlaceholder(
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

export function drawStates(
  ctx: CanvasRenderingContext2D,
  data: NonNullable<UseTransitionAnimationResult["data"]>,
  state: TransitionAnimationState,
  loadedImages: Map<string, HTMLImageElement>,
  bounds: MonitorCanvasBounds,
  monitors: Monitor[]
): void {
  const targetStateIds = new Set(data.targetStates.map((s) => s.id));

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

  data.originStates.forEach((stateObj, index) => {
    const staysVisible = targetStateIds.has(stateObj.id);
    const opacity = staysVisible ? 1 : originOpacity;

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

  if (targetOpacity > 0) {
    const originStateIds = new Set(data.originStates.map((s) => s.id));

    data.targetStates.forEach((stateObj, index) => {
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

  const monitorMap = new Map<number, Monitor>();
  monitors.forEach((m) => monitorMap.set(m.index, m));

  for (const stateImage of state.stateImages || []) {
    const monitorIndex = stateImage.monitors?.[0] ?? 0;
    const monitor = monitorMap.get(monitorIndex);

    for (const pattern of stateImage.patterns || []) {
      const imageId = pattern.imageId;
      if (!imageId) continue;

      const img = loadedImages.get(imageId);
      if (!img) continue;

      let x = 0,
        y = 0;
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (pattern.searchRegions?.[0]) {
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
        const absX = monitor ? monitor.x + pattern.offsetX : pattern.offsetX;
        const absY = monitor ? monitor.y + pattern.offsetY : pattern.offsetY;
        x = absX - bounds.minX;
        y = absY - bounds.minY;
      }

      ctx.drawImage(img, x, y, width, height);

      ctx.strokeStyle = color.border;
      ctx.lineWidth = isTarget ? 3 : 2;
      if (isTarget) {
        ctx.setLineDash([8, 4]);
      }
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);

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

export function drawPhaseIndicator(
  ctx: CanvasRenderingContext2D,
  state: TransitionAnimationState,
  dimensions: { width: number; height: number }
): void {
  let label = "";

  switch (state.phase) {
    case "idle":
      return;
    case "showing-initial":
      label = "Initial State";
      break;
    case "executing-action":
      return;
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
