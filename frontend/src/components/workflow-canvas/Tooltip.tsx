/**
 * Tooltip System - Smart tooltips with rich content
 *
 * Provides tooltips for:
 * - Nodes (action info, status, errors)
 * - Handles (connection info)
 * - Edges (connection details)
 *
 * Features:
 * - Smart positioning (avoids viewport edges)
 * - 500ms delay before show
 * - Rich content with icons
 * - Keyboard shortcut hints
 * - Multiple tooltip types
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CanvasNode, CanvasEdge, CanvasNodeData } from "./canvas-types";
import { COLORS } from "./canvas-config";

// ============================================================================
// Types
// ============================================================================

export type TooltipPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TooltipProps {
  content: React.ReactNode;
  placement?: TooltipPlacement;
  delay?: number;
  offset?: number;
  children: React.ReactNode;
  disabled?: boolean;
}

export interface NodeTooltipData {
  actionName: string;
  actionType: string;
  category: string;
  inputCount?: number;
  outputCount?: number;
  executionState?: "idle" | "running" | "success" | "error" | "warning";
  executionDuration?: number;
  errorMessage?: string;
  disabled?: boolean;
}

export interface HandleTooltipData {
  connectionType: "main" | "error" | "success" | "parallel";
  outputIndex: number;
  connectedCount: number;
  description?: string;
}

export interface EdgeTooltipData {
  sourceNode: string;
  targetNode: string;
  connectionType: "main" | "error" | "success" | "parallel";
  executionCount?: number;
  lastExecuted?: Date;
}

// ============================================================================
// Tooltip Component
// ============================================================================

export function Tooltip({
  content,
  placement = "auto",
  delay = 500,
  offset = 8,
  children,
  disabled = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const [actualPlacement, setActualPlacement] =
    useState<TooltipPlacement>(placement);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const calculatePosition = useCallback(() => {
    if (!targetRef.current || !tooltipRef.current) return;

    const targetRect = targetRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = 0;
    let y = 0;
    let finalPlacement = placement === "auto" ? "top" : placement;

    // Calculate initial position based on placement
    switch (finalPlacement) {
      case "top":
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.top - tooltipRect.height - offset;
        break;
      case "bottom":
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.bottom + offset;
        break;
      case "left":
        x = targetRect.left - tooltipRect.width - offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        break;
      case "right":
        x = targetRect.right + offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        break;
    }

    // Adjust for viewport boundaries
    if (placement === "auto") {
      // Try top
      if (targetRect.top - tooltipRect.height - offset >= 0) {
        finalPlacement = "top";
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.top - tooltipRect.height - offset;
      }
      // Try bottom
      else if (
        targetRect.bottom + tooltipRect.height + offset <=
        viewportHeight
      ) {
        finalPlacement = "bottom";
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.bottom + offset;
      }
      // Try right
      else if (targetRect.right + tooltipRect.width + offset <= viewportWidth) {
        finalPlacement = "right";
        x = targetRect.right + offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
      }
      // Try left
      else {
        finalPlacement = "left";
        x = targetRect.left - tooltipRect.width - offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
      }
    }

    // Keep tooltip in viewport horizontally
    if (x < 10) x = 10;
    if (x + tooltipRect.width > viewportWidth - 10) {
      x = viewportWidth - tooltipRect.width - 10;
    }

    // Keep tooltip in viewport vertically
    if (y < 10) y = 10;
    if (y + tooltipRect.height > viewportHeight - 10) {
      y = viewportHeight - tooltipRect.height - 10;
    }

    setPosition({ x, y });
    setActualPlacement(finalPlacement);
  }, [placement, offset]);

  const showTooltip = useCallback(() => {
    if (disabled) return;

    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      // Calculate position after render
      requestAnimationFrame(calculatePosition);
    }, delay);
  }, [disabled, delay, calculatePosition]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Recalculate position when tooltip becomes visible
  useEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible, calculatePosition]);

  return (
    <>
      <div
        ref={targetRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        className="inline-block"
      >
        {children}
      </div>

      {isVisible && position && (
        <div
          ref={tooltipRef}
          className="fixed z-[10000] pointer-events-none"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
          }}
        >
          <div
            className="bg-gray-900 text-gray-100 text-sm rounded-lg shadow-xl border border-gray-700 px-3 py-2 max-w-xs"
            style={{
              animation: "tooltipFadeIn 150ms ease-out",
            }}
          >
            {content}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
}

// ============================================================================
// Node Tooltip Component
// ============================================================================

export function NodeTooltip({ data }: { data: NodeTooltipData }) {
  const statusColors = {
    idle: COLORS.idle,
    running: COLORS.running,
    success: COLORS.successState,
    error: COLORS.errorState,
    warning: COLORS.warning,
  };

  const statusIcons = {
    idle: "●",
    running: "◌",
    success: "✓",
    error: "✕",
    warning: "⚠",
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">
            {data.actionName}
          </div>
          <div className="text-xs text-gray-400">{data.actionType}</div>
        </div>
        {data.executionState && (
          <div
            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{
              backgroundColor: `${statusColors[data.executionState]}20`,
              color: statusColors[data.executionState],
            }}
          >
            <span>{statusIcons[data.executionState]}</span>
            <span className="capitalize">{data.executionState}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      {(data.inputCount !== undefined || data.outputCount !== undefined) && (
        <div className="flex gap-4 text-xs text-gray-400">
          {data.inputCount !== undefined && (
            <div>
              <span className="text-gray-500">Inputs:</span> {data.inputCount}
            </div>
          )}
          {data.outputCount !== undefined && (
            <div>
              <span className="text-gray-500">Outputs:</span> {data.outputCount}
            </div>
          )}
        </div>
      )}

      {/* Execution Duration */}
      {data.executionDuration !== undefined && (
        <div className="text-xs text-gray-400">
          <span className="text-gray-500">Duration:</span>{" "}
          {data.executionDuration}ms
        </div>
      )}

      {/* Error Message */}
      {data.errorMessage && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded">
          {data.errorMessage}
        </div>
      )}

      {/* Disabled State */}
      {data.disabled && (
        <div className="text-xs text-gray-500 italic">
          This node is disabled
        </div>
      )}

      {/* Category Badge */}
      <div className="pt-1 border-t border-gray-700">
        <span className="inline-block text-xs px-2 py-1 bg-gray-800 rounded text-gray-400">
          {data.category}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Handle Tooltip Component
// ============================================================================

export function HandleTooltip({ data }: { data: HandleTooltipData }) {
  const typeColors = {
    main: COLORS.main,
    error: COLORS.error,
    success: COLORS.success,
  };

  const typeLabels = {
    main: "Main Flow",
    error: "Error Handling",
    success: "Success Condition",
  };

  return (
    <div className="space-y-2">
      {/* Connection Type */}
      <div
        className="inline-block text-xs px-2 py-1 rounded font-medium"
        style={{
          backgroundColor: `${typeColors[data.connectionType]}20`,
          color: typeColors[data.connectionType],
        }}
      >
        {typeLabels[data.connectionType]}
      </div>

      {/* Output Index */}
      <div className="text-xs text-gray-400">
        <span className="text-gray-500">Output:</span> #{data.outputIndex}
      </div>

      {/* Connected Count */}
      <div className="text-xs text-gray-400">
        <span className="text-gray-500">Connections:</span>{" "}
        {data.connectedCount}
      </div>

      {/* Description */}
      {data.description && (
        <div className="text-xs text-gray-300 pt-1 border-t border-gray-700">
          {data.description}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Edge Tooltip Component
// ============================================================================

export function EdgeTooltip({ data }: { data: EdgeTooltipData }) {
  const typeColors = {
    main: COLORS.main,
    error: COLORS.error,
    success: COLORS.success,
  };

  const typeLabels = {
    main: "Main Flow",
    error: "Error Handling",
    success: "Success Condition",
  };

  return (
    <div className="space-y-2">
      {/* Connection Flow */}
      <div className="text-sm">
        <div className="text-gray-400 text-xs mb-1">Connection:</div>
        <div className="flex items-center gap-2">
          <span className="text-white font-medium truncate max-w-[100px]">
            {data.sourceNode}
          </span>
          <svg
            className="w-4 h-4 text-gray-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-white font-medium truncate max-w-[100px]">
            {data.targetNode}
          </span>
        </div>
      </div>

      {/* Connection Type */}
      <div
        className="inline-block text-xs px-2 py-1 rounded font-medium"
        style={{
          backgroundColor: `${typeColors[data.connectionType]}20`,
          color: typeColors[data.connectionType],
        }}
      >
        {typeLabels[data.connectionType]}
      </div>

      {/* Execution Stats */}
      {data.executionCount !== undefined && (
        <div className="text-xs text-gray-400">
          <span className="text-gray-500">Executed:</span> {data.executionCount}{" "}
          times
        </div>
      )}

      {data.lastExecuted && (
        <div className="text-xs text-gray-400">
          <span className="text-gray-500">Last run:</span>{" "}
          {data.lastExecuted.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Keyboard Shortcut Tooltip
// ============================================================================

export function ShortcutTooltip({
  description,
  shortcut,
  children,
}: {
  description: string;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip
      content={
        <div className="flex items-center justify-between gap-4">
          <span>{description}</span>
          <span className="text-xs px-2 py-1 bg-gray-800 rounded font-mono text-gray-400">
            {shortcut}
          </span>
        </div>
      }
      delay={500}
    >
      {children}
    </Tooltip>
  );
}

// ============================================================================
// Helper Hook - Tooltip State Management
// ============================================================================

export function useTooltip(delay: number = 500) {
  const [isVisible, setIsVisible] = useState(false);
  const [content, setContent] = useState<React.ReactNode>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const show = useCallback(
    (tooltipContent: React.ReactNode) => {
      timeoutRef.current = setTimeout(() => {
        setContent(tooltipContent);
        setIsVisible(true);
      }, delay);
    },
    [delay]
  );

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    isVisible,
    content,
    show,
    hide,
  };
}

// ============================================================================
// Tooltip Manager - Global tooltip state
// ============================================================================

interface TooltipState {
  content: React.ReactNode;
  position: { x: number; y: number };
  placement: TooltipPlacement;
}

let tooltipState: TooltipState | null = null;
let tooltipListeners: Array<(state: TooltipState | null) => void> = [];

export const TooltipManager = {
  show(
    content: React.ReactNode,
    position: { x: number; y: number },
    placement: TooltipPlacement = "auto"
  ) {
    tooltipState = { content, position, placement };
    tooltipListeners.forEach((listener) => listener(tooltipState));
  },

  hide() {
    tooltipState = null;
    tooltipListeners.forEach((listener) => listener(null));
  },

  subscribe(listener: (state: TooltipState | null) => void) {
    tooltipListeners.push(listener);
    return () => {
      tooltipListeners = tooltipListeners.filter((l) => l !== listener);
    };
  },

  getState() {
    return tooltipState;
  },
};

// ============================================================================
// Global Tooltip Container
// ============================================================================

export function TooltipContainer() {
  const [state, setState] = useState<TooltipState | null>(null);

  useEffect(() => {
    return TooltipManager.subscribe(setState);
  }, []);

  if (!state) return null;

  return (
    <div
      className="fixed z-[10000] pointer-events-none"
      style={{
        left: `${state.position.x}px`,
        top: `${state.position.y}px`,
      }}
    >
      <div className="bg-gray-900 text-gray-100 text-sm rounded-lg shadow-xl border border-gray-700 px-3 py-2 max-w-xs">
        {state.content}
      </div>
    </div>
  );
}

export default Tooltip;
