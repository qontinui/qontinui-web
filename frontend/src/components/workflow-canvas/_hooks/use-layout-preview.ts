import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { ViewMode, BoundingBox } from "../layout-preview-types";
import {
  calculateBoundingBox,
  drawGrid,
  drawConnections,
  drawNode,
} from "../layout-preview-canvas";

interface UseLayoutPreviewParams {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  initialMode: ViewMode;
  showChangedNodes: boolean;
  interactive: boolean;
}

export function useLayoutPreview({
  beforeWorkflow,
  afterWorkflow,
  initialMode,
  showChangedNodes,
  interactive,
}: UseLayoutPreviewParams) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [overlaySlider, setOverlaySlider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const canvasRefBefore = useRef<HTMLCanvasElement>(null);
  const canvasRefAfter = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const beforeBBox = useMemo(
    () => calculateBoundingBox(beforeWorkflow.actions),
    [beforeWorkflow]
  );
  const afterBBox = useMemo(
    () => calculateBoundingBox(afterWorkflow.actions),
    [afterWorkflow]
  );

  const changedNodeIds = useMemo(() => {
    const changed = new Set<string>();
    for (const action of beforeWorkflow.actions) {
      const afterAction = afterWorkflow.actions.find((a) => a.id === action.id);
      if (afterAction && action.position && afterAction.position) {
        const [x1, y1] = action.position;
        const [x2, y2] = afterAction.position;
        const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        if (distance > 1) {
          changed.add(action.id);
        }
      }
    }
    return changed;
  }, [beforeWorkflow, afterWorkflow]);

  const drawWorkflow = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      workflow: Workflow,
      bbox: BoundingBox,
      highlightChanges: boolean
    ) => {
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const padding = 40;
      const scaleX = (canvas.width - padding * 2) / bbox.width;
      const scaleY = (canvas.height - padding * 2) / bbox.height;
      const scale = Math.min(scaleX, scaleY, 1) * zoom;

      const offsetX =
        (canvas.width - bbox.width * scale) / 2 - bbox.minX * scale + pan.x;
      const offsetY =
        (canvas.height - bbox.height * scale) / 2 - bbox.minY * scale + pan.y;

      drawGrid(ctx, canvas.width, canvas.height, scale, offsetX, offsetY);
      drawConnections(ctx, workflow, scale, offsetX, offsetY);

      for (const action of workflow.actions) {
        if (!action.position) continue;

        const isChanged =
          highlightChanges && showChangedNodes && changedNodeIds.has(action.id);
        drawNode(ctx, action, scale, offsetX, offsetY, isChanged);
      }
    },
    [zoom, pan, showChangedNodes, changedNodeIds]
  );

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bbox = {
      minX: Math.min(beforeBBox.minX, afterBBox.minX),
      maxX: Math.max(beforeBBox.maxX, afterBBox.maxX),
      minY: Math.min(beforeBBox.minY, afterBBox.minY),
      maxY: Math.max(beforeBBox.maxY, afterBBox.maxY),
      width: Math.max(beforeBBox.width, afterBBox.width),
      height: Math.max(beforeBBox.height, afterBBox.height),
    };

    const padding = 40;
    const scaleX = (canvas.width - padding * 2) / bbox.width;
    const scaleY = (canvas.height - padding * 2) / bbox.height;
    const scale = Math.min(scaleX, scaleY, 1) * zoom;

    const offsetX =
      (canvas.width - bbox.width * scale) / 2 - bbox.minX * scale + pan.x;
    const offsetY =
      (canvas.height - bbox.height * scale) / 2 - bbox.minY * scale + pan.y;

    ctx.save();
    ctx.globalAlpha = 1 - overlaySlider / 100;
    drawConnections(ctx, beforeWorkflow, scale, offsetX, offsetY);
    for (const action of beforeWorkflow.actions) {
      if (action.position) {
        drawNode(ctx, action, scale, offsetX, offsetY, false, "#3b82f6");
      }
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = overlaySlider / 100;
    drawConnections(ctx, afterWorkflow, scale, offsetX, offsetY);
    for (const action of afterWorkflow.actions) {
      if (action.position) {
        drawNode(
          ctx,
          action,
          scale,
          offsetX,
          offsetY,
          showChangedNodes && changedNodeIds.has(action.id),
          "#10b981"
        );
      }
    }
    ctx.restore();
  }, [
    beforeBBox,
    afterBBox,
    beforeWorkflow,
    afterWorkflow,
    zoom,
    pan,
    overlaySlider,
    showChangedNodes,
    changedNodeIds,
  ]);

  useEffect(() => {
    if (viewMode === "overlay") {
      drawOverlay();
    } else {
      if (viewMode !== "after-only") {
        drawWorkflow(
          canvasRefBefore.current,
          beforeWorkflow,
          beforeBBox,
          false
        );
      }
      if (viewMode !== "before-only") {
        drawWorkflow(canvasRefAfter.current, afterWorkflow, afterBBox, true);
      }
    }
  }, [
    viewMode,
    beforeWorkflow,
    afterWorkflow,
    beforeBBox,
    afterBBox,
    drawWorkflow,
    drawOverlay,
  ]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [interactive, pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive || !isPanning) return;
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    },
    [interactive, isPanning, panStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(5, prev * delta)));
    },
    [interactive]
  );

  const handleZoomIn = useCallback(
    () => setZoom((prev) => Math.min(5, prev * 1.2)),
    []
  );
  const handleZoomOut = useCallback(
    () => setZoom((prev) => Math.max(0.1, prev / 1.2)),
    []
  );
  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return {
    viewMode,
    setViewMode,
    overlaySlider,
    setOverlaySlider,
    zoom,
    changedNodeIds,
    canvasRefBefore,
    canvasRefAfter,
    overlayCanvasRef,
    canvasHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onWheel: handleWheel,
    },
    zoomControls: {
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onReset: handleZoomReset,
    },
  };
}
