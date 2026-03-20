"use client";

import React, { useEffect } from "react";
import type { Monitor } from "@/lib/schemas/geometry";
import { useTransitionAnimation } from "./TransitionAnimationController";
import { useMonitorCanvas } from "./useMonitorCanvas";
import { MonitorFilter } from "./MonitorFilter";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TransitionAnimationCanvasProps } from "./TransitionAnimationCanvas-types";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
} from "./TransitionAnimationCanvas-types";
import { useTransitionCanvasData } from "./_hooks/useTransitionCanvasData";
import { useTransitionCanvasRenderer } from "./_hooks/useTransitionCanvasRenderer";
import { TransitionStateLegend } from "./_components/TransitionStateLegend";
import { TransitionActionIndicator } from "./_components/TransitionActionIndicator";

const DEFAULT_MONITORS: Monitor[] = [];

export function TransitionAnimationCanvas({
  transition,
  states,
  workflows,
  images,
  monitors = DEFAULT_MONITORS,
  className,
  animation: externalAnimation,
  controllerRef,
  showMonitorFilter = true,
}: TransitionAnimationCanvasProps) {
  const internalAnimation = useTransitionAnimation();
  const animation = externalAnimation ?? internalAnimation;

  // Expose controller via ref (deprecated - for backward compatibility)
  useEffect(() => {
    if (controllerRef) {
      controllerRef.current = animation;
    }
  }, [animation, controllerRef]);

  const {
    loadedImages,
    showOnlyWithElements,
    setShowOnlyWithElements,
    monitorsWithElements,
  } = useTransitionCanvasData(animation, images, monitors);

  const canvas = useMonitorCanvas({
    monitors,
    monitorsWithElements,
    showOnlyWithElements,
    maxZoom: 5,
    minFitZoom: 0.4,
    defaultDimensions: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    pinToTop: true,
  });

  // Load transition when it changes
  useEffect(() => {
    if (transition) {
      animation.loadTransition(transition, states, workflows, monitors);
    } else {
      animation.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition?.id, monitors]);

  useTransitionCanvasRenderer({
    canvasRef: canvas.canvasRef,
    animation,
    transition,
    monitors,
    loadedImages,
    pan: canvas.pan,
    zoom: canvas.zoom,
    bounds: canvas.bounds,
    containerSize: canvas.containerSize,
    displayedMonitors: canvas.displayedMonitors,
  });

  return (
    <div
      ref={canvas.containerRef}
      role="application"
      aria-label="Transition animation canvas"
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

      {animation.data && <TransitionStateLegend data={animation.data} />}

      <TransitionActionIndicator
        state={animation.state}
        currentAction={animation.currentAction}
      />
    </div>
  );
}

export default TransitionAnimationCanvas;
