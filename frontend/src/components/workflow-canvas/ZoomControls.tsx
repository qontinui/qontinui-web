/**
 * Zoom Controls - Enhanced zoom controls for canvas
 *
 * Controls:
 * - Zoom In (+)
 * - Zoom Out (-)
 * - Fit View
 * - Zoom to Selection
 * - Reset Zoom (100%)
 * - Zoom percentage display
 *
 * Features:
 * - Keyboard shortcuts: +, -, 0
 * - Mouse wheel zoom
 * - Zoom limits: 10% - 400%
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ZOOM_CONFIG } from "./canvas-config";

// ============================================================================
// Types
// ============================================================================

export interface ZoomControlsProps {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  showPercentage?: boolean;
  className?: string;
}

// ============================================================================
// Zoom Controls Component
// ============================================================================

export function ZoomControls({
  position = "bottom-left",
  showPercentage = true,
  className = "",
}: ZoomControlsProps) {
  const reactFlow = useReactFlow();
  const [zoom, setZoom] = useState(1);

  // Get current zoom level
  useEffect(() => {
    const updateZoom = () => {
      const viewport = reactFlow.getViewport();
      setZoom(viewport.zoom);
    };

    updateZoom();

    // Listen for viewport changes
    const interval = setInterval(updateZoom, 100);
    return () => clearInterval(interval);
  }, [reactFlow]);

  // Zoom actions
  const handleZoomIn = useCallback(() => {
    reactFlow.zoomIn({ duration: ZOOM_CONFIG.animationDuration });
  }, [reactFlow]);

  const handleZoomOut = useCallback(() => {
    reactFlow.zoomOut({ duration: ZOOM_CONFIG.animationDuration });
  }, [reactFlow]);

  const handleFitView = useCallback(() => {
    reactFlow.fitView({
      padding: ZOOM_CONFIG.fitViewPadding,
      duration: ZOOM_CONFIG.animationDuration,
    });
  }, [reactFlow]);

  const handleResetZoom = useCallback(() => {
    reactFlow.setViewport(
      { x: 0, y: 0, zoom: ZOOM_CONFIG.default },
      { duration: ZOOM_CONFIG.animationDuration }
    );
  }, [reactFlow]);

  const handleZoomToSelection = useCallback(() => {
    reactFlow.fitView({
      padding: ZOOM_CONFIG.fitViewPadding,
      duration: ZOOM_CONFIG.animationDuration,
      includeHiddenNodes: false,
    });
  }, [reactFlow]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom in: +, =
      if ((e.key === "+" || e.key === "=") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleZoomIn();
      }

      // Zoom out: -, _
      if ((e.key === "-" || e.key === "_") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleZoomOut();
      }

      // Reset zoom: 0
      if (e.key === "0" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleResetZoom();
      }

      // Fit view: Ctrl+F
      if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleFitView();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleResetZoom, handleFitView]);

  // Position styles
  const positionStyles = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
  };

  const zoomPercentage = Math.round(zoom * 100);
  const canZoomIn = zoom < ZOOM_CONFIG.max;
  const canZoomOut = zoom > ZOOM_CONFIG.min;

  return (
    <div
      className={`fixed z-[1000] flex flex-col gap-2 ${positionStyles[position]} ${className}`}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
        {/* Zoom In */}
        <button
          onClick={handleZoomIn}
          disabled={!canZoomIn}
          className="w-10 h-10 flex items-center justify-center text-white hover:bg-gray-700 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors border-b border-gray-700"
          title="Zoom In (+)"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>

        {/* Zoom Percentage */}
        {showPercentage && (
          <button
            onClick={handleResetZoom}
            className="w-10 h-10 flex items-center justify-center text-xs text-gray-300 hover:bg-gray-700 transition-colors border-b border-gray-700"
            title="Reset Zoom (0)"
          >
            {zoomPercentage}%
          </button>
        )}

        {/* Zoom Out */}
        <button
          onClick={handleZoomOut}
          disabled={!canZoomOut}
          className="w-10 h-10 flex items-center justify-center text-white hover:bg-gray-700 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors border-b border-gray-700"
          title="Zoom Out (-)"
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
              d="M20 12H4"
            />
          </svg>
        </button>

        {/* Fit View */}
        <button
          onClick={handleFitView}
          className="w-10 h-10 flex items-center justify-center text-white hover:bg-gray-700 transition-colors border-b border-gray-700"
          title="Fit View (Ctrl+F)"
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
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>

        {/* Zoom to Selection */}
        <button
          onClick={handleZoomToSelection}
          className="w-10 h-10 flex items-center justify-center text-white hover:bg-gray-700 transition-colors"
          title="Zoom to Selection"
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
            />
          </svg>
        </button>
      </div>

      {/* Zoom limits indicator */}
      {(zoom <= ZOOM_CONFIG.min || zoom >= ZOOM_CONFIG.max) && (
        <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-400">
          {zoom <= ZOOM_CONFIG.min && "Min zoom"}
          {zoom >= ZOOM_CONFIG.max && "Max zoom"}
        </div>
      )}
    </div>
  );
}

export default ZoomControls;
