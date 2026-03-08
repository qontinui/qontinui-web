/**
 * Canvas Toolbar - Top-right panel with canvas action buttons
 */

"use client";

import React from "react";
import { Panel } from "@xyflow/react";

export interface CanvasToolbarProps {
  readonly: boolean;
  onFitView: () => void;
  onAutoLayout: () => void;
}

export function CanvasToolbar({
  readonly,
  onFitView,
  onAutoLayout,
}: CanvasToolbarProps) {
  return (
    <Panel
      position="top-right"
      className="workflow-canvas-panel"
      data-tutorial-id="canvas-toolbar"
    >
      <div className="flex gap-2">
        <button
          onClick={onFitView}
          className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 text-white rounded text-sm"
          title="Fit view (Ctrl+F)"
          data-tutorial-id="fit-view"
        >
          Fit View
        </button>
        {!readonly && (
          <>
            <button
              onClick={onAutoLayout}
              className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 text-white rounded text-sm"
              title="Auto layout (Ctrl+L)"
              data-tutorial-id="auto-layout"
            >
              Auto Layout
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
