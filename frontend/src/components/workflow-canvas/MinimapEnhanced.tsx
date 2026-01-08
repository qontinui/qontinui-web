/**
 * Enhanced Minimap - Advanced minimap with additional features
 *
 * Enhancements:
 * - Node colors by category
 * - Execution state indicators
 * - Zoom indicator
 * - Click to navigate
 * - Drag to pan
 * - Show/hide toggle
 */

"use client";

import React, { useState } from "react";
import { MiniMap } from "@xyflow/react";
import { CanvasNode } from "./canvas-types";
import { getActionCategory } from "./canvas-types";
import { getCategoryColor, COLORS } from "./canvas-config";

// ============================================================================
// Types
// ============================================================================

export interface MinimapEnhancedProps {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  showToggle?: boolean;
  defaultVisible?: boolean;
}

// ============================================================================
// Enhanced Minimap Component
// ============================================================================

export function MinimapEnhanced({
  position = "bottom-right",
  showToggle = true,
  defaultVisible = true,
}: MinimapEnhancedProps) {
  const [isVisible, setIsVisible] = useState(defaultVisible);

  const getNodeColor = (node: unknown): string => {
    const canvasNode = node as CanvasNode;

    // Color by execution state if available
    if (canvasNode.data?.executionState) {
      switch (canvasNode.data.executionState) {
        case "running":
          return COLORS.running;
        case "success":
          return COLORS.successState;
        case "error":
          return COLORS.errorState;
        case "warning":
          return COLORS.warning;
        default:
          return COLORS.idle;
      }
    }

    // Color by category
    if (canvasNode.data?.action?.type) {
      const category = getActionCategory(canvasNode.data.action.type);
      return getCategoryColor(category);
    }

    return COLORS.primary;
  };

  if (!isVisible && showToggle) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 z-[1000] px-3 py-2 bg-surface-raised hover:bg-border-default border border-border-default rounded-lg shadow-xl text-white text-sm transition-colors"
        title="Show Minimap"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
          />
        </svg>
      </button>
    );
  }

  if (!isVisible) return null;

  return (
    <div className="relative">
      <MiniMap
        nodeColor={getNodeColor}
        nodeBorderRadius={4}
        maskColor="rgba(0, 217, 255, 0.1)"
        position={position}
        style={{
          backgroundColor: "rgba(24, 24, 27, 0.95)",
          border: "1px solid #3F3F46",
          borderRadius: "8px",
        }}
      />

      {/* Toggle button */}
      {showToggle && (
        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-2 right-2 p-1 bg-surface-canvas/50 hover:bg-surface-canvas/80 rounded text-text-muted hover:text-white transition-colors"
          title="Hide Minimap"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 right-2 text-xs space-y-1">
        <div className="bg-surface-canvas/80 rounded px-2 py-1 space-y-1">
          <div className="text-text-muted font-semibold mb-1">State</div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: COLORS.running }}
            />
            <span className="text-text-muted">Running</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: COLORS.successState }}
            />
            <span className="text-text-muted">Success</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: COLORS.errorState }}
            />
            <span className="text-text-muted">Error</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MinimapEnhanced;
