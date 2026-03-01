/**
 * Grid Settings Panel - Configure canvas grid appearance
 *
 * Settings:
 * - Show/hide grid
 * - Snap to grid toggle
 * - Grid size (5, 10, 15, 20, 25, 50)
 * - Grid color
 * - Grid pattern (dots, lines, cross)
 */

"use client";

import React, { useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";

// ============================================================================
// Types
// ============================================================================

export interface GridSettingsProps {
  onClose?: () => void;
}

const GRID_SIZES = [5, 10, 15, 20, 25, 50];

// ============================================================================
// Grid Settings Component
// ============================================================================

export function GridSettings({ onClose }: GridSettingsProps) {
  const {
    showGrid,
    snapToGrid,
    gridSize,
    toggleGrid,
    toggleSnapToGrid,
    setGridSize,
  } = useCanvasStore();

  return (
    <div className="bg-surface-raised border border-border-default rounded-lg shadow-xl p-4 min-w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold">Grid Settings</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-text-muted hover:text-white transition-colors"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Settings */}
      <div className="space-y-4">
        {/* Show Grid Toggle */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">Show Grid</p>
          <button
            onClick={toggleGrid}
            className={`
              relative inline-flex h-6 w-11 items-center rounded-full transition-colors
              ${showGrid ? "bg-cyan-500" : "bg-border-default"}
            `}
          >
            <span
              className={`
                inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${showGrid ? "translate-x-6" : "translate-x-1"}
              `}
            />
          </button>
        </div>

        {/* Snap to Grid Toggle */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">Snap to Grid</p>
          <button
            onClick={toggleSnapToGrid}
            className={`
              relative inline-flex h-6 w-11 items-center rounded-full transition-colors
              ${snapToGrid ? "bg-cyan-500" : "bg-border-default"}
            `}
          >
            <span
              className={`
                inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${snapToGrid ? "translate-x-6" : "translate-x-1"}
              `}
            />
          </button>
        </div>

        {/* Grid Size */}
        <div>
          <p className="text-sm text-text-secondary block mb-2">
            Grid Size: {gridSize}px
          </p>
          <div className="grid grid-cols-3 gap-2">
            {GRID_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => setGridSize(size)}
                className={`
                  px-3 py-2 rounded text-sm transition-colors
                  ${
                    size === gridSize
                      ? "bg-cyan-500 text-white"
                      : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
                  }
                `}
              >
                {size}px
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="pt-4 border-t border-border-default">
          <p className="text-sm text-text-secondary block mb-2">Preview</p>
          <div
            className="w-full h-24 rounded border border-border-default"
            style={{
              backgroundImage: showGrid
                ? `radial-gradient(circle, #3F3F46 2px, transparent 2px)`
                : "none",
              backgroundSize: `${gridSize}px ${gridSize}px`,
              backgroundColor: "#18181B",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Grid Settings Button
// ============================================================================

export function GridSettingsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 text-white rounded text-sm border border-border-default transition-colors"
        title="Grid Settings"
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
            d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"
          />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            role="button"
            tabIndex={0}
            onClick={() => setIsOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsOpen(false);
              }
            }}
          />

          {/* Settings Panel */}
          <div className="absolute top-full right-0 mt-2 z-50">
            <GridSettings onClose={() => setIsOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}

export default GridSettings;
