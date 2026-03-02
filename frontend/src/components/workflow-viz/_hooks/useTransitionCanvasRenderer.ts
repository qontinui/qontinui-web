import { useEffect } from "react";
import type { Monitor } from "@/lib/schemas/geometry";
import type { Transition } from "@/contexts/automation-context/types";
import type { UseTransitionAnimationResult } from "../TransitionAnimationController";
import { renderActionAnimation } from "../ActionAnimations";
import {
  drawMonitorBackground,
  DARK_THEME,
  type MonitorCanvasBounds,
} from "../useMonitorCanvas";
import {
  drawPlaceholder,
  drawStates,
  drawPhaseIndicator,
  transformActionCoordinates,
} from "../TransitionAnimationCanvas-utils";

interface UseTransitionCanvasRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  animation: UseTransitionAnimationResult;
  transition: Transition | null;
  monitors: Monitor[];
  loadedImages: Map<string, HTMLImageElement>;
  pan: { x: number; y: number };
  zoom: number;
  bounds: MonitorCanvasBounds;
  containerSize: { width: number; height: number };
  displayedMonitors: Monitor[];
}

export function useTransitionCanvasRenderer(
  options: UseTransitionCanvasRendererOptions
) {
  const {
    canvasRef,
    animation,
    transition,
    monitors,
    loadedImages,
    pan,
    zoom,
    bounds,
    containerSize,
    displayedMonitors,
  } = options;

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    if (containerSize.width === 0 || containerSize.height === 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = containerSize.width * dpr;
    canvasEl.height = containerSize.height * dpr;

    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    ctx.save();

    ctx.scale(dpr, dpr);

    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    drawMonitorBackground(ctx, bounds, displayedMonitors, DARK_THEME);

    const data = animation.data;
    const state = animation.state;

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
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[TransitionAnimation] Canvas: rendering with no data (showing placeholder)",
          {
            phase: state.phase,
            hasTransition: !!transition,
          }
        );
      }
      drawPlaceholder(ctx, bounds);
    } else {
      drawStates(ctx, data, state, loadedImages, bounds, monitors);

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
            x: bounds.width / 2,
            y: bounds.height / 2,
          };

          const transformedAction = transformActionCoordinates(
            currentAction,
            bounds
          );

          renderActionAnimation(
            ctx,
            transformedAction,
            state.progress,
            canvasCenter
          );
        }
      }

      drawPhaseIndicator(ctx, state, bounds);
    }

    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    animation.state,
    animation.data,
    animation.currentAction,
    pan,
    zoom,
    bounds,
    containerSize,
    displayedMonitors,
    loadedImages,
    monitors,
  ]);
}
