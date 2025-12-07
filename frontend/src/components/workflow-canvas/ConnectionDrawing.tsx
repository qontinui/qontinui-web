/**
 * Connection Drawing System - Interactive connection creation
 *
 * Features:
 * - Click handle to start connection
 * - Drag to target handle
 * - Show preview line during drag
 * - Highlight valid drop targets
 * - Show invalid targets (red)
 * - Multi-output: Show output type selector
 * - Cancel on Escape or right-click
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { COLORS, getConnectionColor } from "./canvas-config";

// ============================================================================
// Types
// ============================================================================

export interface ConnectionDrawingState {
  active: boolean;
  sourceNodeId: string | null;
  sourceHandleId: string | null;
  sourcePosition: { x: number; y: number } | null;
  currentPosition: { x: number; y: number } | null;
  outputType: "main" | "error" | "success" | "parallel";
  outputIndex: number;
  validTargets: Set<string>;
}

export interface ConnectionDrawingProps {
  state: ConnectionDrawingState;
  onComplete?: (targetNodeId: string, targetHandleId: string) => void;
  onCancel?: () => void;
}

// ============================================================================
// Connection Preview Line Component
// ============================================================================

export function ConnectionPreviewLine({
  start,
  end,
  color = COLORS.main,
  valid = true,
}: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  color?: string;
  valid?: boolean;
}) {
  // Calculate smooth bezier path
  const dx = end.x - start.x;

  const controlPoint1X = start.x + dx * 0.5;
  const controlPoint1Y = start.y;
  const controlPoint2X = end.x - dx * 0.5;
  const controlPoint2Y = end.y;

  const pathD = `M ${start.x} ${start.y} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${end.x} ${end.y}`;

  const lineColor = valid ? color : COLORS.error;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 9998 }}
    >
      <defs>
        <marker
          id="arrowhead-preview"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 10 3, 0 6" fill={lineColor} />
        </marker>
      </defs>
      <path
        d={pathD}
        stroke={lineColor}
        strokeWidth="3"
        fill="none"
        strokeDasharray={valid ? "0" : "8,4"}
        markerEnd="url(#arrowhead-preview)"
        style={{
          filter: "drop-shadow(0 0 6px rgba(0,0,0,0.5))",
        }}
      />
    </svg>
  );
}

// ============================================================================
// Connection Drawing Component
// ============================================================================

export function ConnectionDrawing({
  state,
  onComplete: _onComplete,
  onCancel: _onCancel,
}: ConnectionDrawingProps) {
  if (!state.active || !state.sourcePosition || !state.currentPosition) {
    return null;
  }

  const color = getConnectionColor(state.outputType);
  const isValid = state.validTargets.size > 0;

  return (
    <>
      <ConnectionPreviewLine
        start={state.sourcePosition}
        end={state.currentPosition}
        color={color}
        valid={isValid}
      />

      {/* Connection info tooltip */}
      <div
        className="fixed z-[9999] pointer-events-none"
        style={{
          left: `${state.currentPosition.x + 20}px`,
          top: `${state.currentPosition.y - 20}px`,
        }}
      >
        <div className="bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl border border-gray-700">
          <div className="font-semibold" style={{ color }}>
            {state.outputType.charAt(0).toUpperCase() +
              state.outputType.slice(1)}{" "}
            Connection
          </div>
          <div className="text-gray-400 mt-1">
            {isValid ? "Drag to target handle" : "No valid targets"}
          </div>
          <div className="text-gray-500 text-xs mt-1">Press Esc to cancel</div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Connection Drawing Hook
// ============================================================================

export function useConnectionDrawing() {
  const [state, setState] = useState<ConnectionDrawingState>({
    active: false,
    sourceNodeId: null,
    sourceHandleId: null,
    sourcePosition: null,
    currentPosition: null,
    outputType: "main",
    outputIndex: 0,
    validTargets: new Set(),
  });

  const { startConnecting, cancelConnecting, finishConnecting, workflow } =
    useCanvasStore();

  const startConnection = useCallback(
    (
      nodeId: string,
      handleId: string,
      position: { x: number; y: number },
      outputType: "main" | "error" | "success" | "parallel" = "main",
      outputIndex: number = 0
    ) => {
      // Calculate valid targets: all actions except the source itself
      const validTargets = new Set<string>();
      if (workflow) {
        workflow.actions.forEach((action) => {
          // Don't allow connecting to itself
          if (action.id !== nodeId) {
            validTargets.add(action.id);
          }
        });
      }

      setState({
        active: true,
        sourceNodeId: nodeId,
        sourceHandleId: handleId,
        sourcePosition: position,
        currentPosition: position,
        outputType,
        outputIndex,
        validTargets,
      });

      startConnecting(nodeId, outputType, outputIndex);
    },
    [startConnecting, workflow]
  );

  const updateConnection = useCallback((position: { x: number; y: number }) => {
    setState((prev) => ({
      ...prev,
      currentPosition: position,
    }));
  }, []);

  const completeConnection = useCallback(
    (targetNodeId: string, targetHandleId: string) => {
      if (!state.sourceNodeId) return;

      const targetIndex = parseInt(targetHandleId.split("-").pop() || "0");
      finishConnecting(targetNodeId, targetIndex);

      setState({
        active: false,
        sourceNodeId: null,
        sourceHandleId: null,
        sourcePosition: null,
        currentPosition: null,
        outputType: "main",
        outputIndex: 0,
        validTargets: new Set(),
      });
    },
    [state.sourceNodeId, finishConnecting]
  );

  const cancelConnection = useCallback(() => {
    cancelConnecting();

    setState({
      active: false,
      sourceNodeId: null,
      sourceHandleId: null,
      sourcePosition: null,
      currentPosition: null,
      outputType: "main",
      outputIndex: 0,
      validTargets: new Set(),
    });
  }, [cancelConnecting]);

  // Handle mouse move during connection
  useEffect(() => {
    if (!state.active) return;

    const handleMouseMove = (e: MouseEvent) => {
      updateConnection({ x: e.clientX, y: e.clientY });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelConnection();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Cancel on right click
      if (e.button === 2) {
        e.preventDefault();
        cancelConnection();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleMouseDown);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [state.active, updateConnection, cancelConnection]);

  return {
    state,
    startConnection,
    updateConnection,
    completeConnection,
    cancelConnection,
  };
}

// ============================================================================
// Connection Drawing Manager
// ============================================================================

export function ConnectionDrawingManager() {
  const { state, completeConnection, cancelConnection } =
    useConnectionDrawing();

  return (
    <ConnectionDrawing
      state={state}
      onComplete={completeConnection}
      onCancel={cancelConnection}
    />
  );
}

export default ConnectionDrawing;
