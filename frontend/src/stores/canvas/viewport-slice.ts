/**
 * Viewport Slice - Manages viewport state, pan, and zoom
 *
 * Responsibilities:
 * - Viewport position and zoom level
 * - Pan/drag state
 * - Zoom operations (in, out, reset, fit)
 * - Viewport manipulation
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, ViewportSlice, Viewport } from "./types";

export const createViewportSlice: StateCreator<
  CanvasStore,
  [["zustand/immer", never]],
  [],
  ViewportSlice
> = (set) => ({
  // State
  viewport: { x: 0, y: 0, zoom: 1 },
  isDragging: false,
  isPanning: false,

  // Actions
  setViewport: (viewport: Partial<Viewport>) => {
    set((state) => {
      state.viewport = { ...state.viewport, ...viewport };
    });
  },

  fitView: () => {
    set((state) => {
      const workflow = state.workflow;
      if (!workflow || workflow.actions.length === 0) {
        state.viewport = { x: 0, y: 0, zoom: 1 };
        return;
      }

      // Calculate bounding box of all actions
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      const NODE_WIDTH = 200;
      const NODE_HEIGHT = 100;
      const PADDING = 50;

      for (const action of workflow.actions) {
        const [x, y] = action.position;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + NODE_WIDTH);
        maxY = Math.max(maxY, y + NODE_HEIGHT);
      }

      // Calculate viewport dimensions (assume standard canvas size)
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : 1920;
      const viewportHeight =
        typeof window !== "undefined" ? window.innerHeight : 1080;

      const contentWidth = maxX - minX + 2 * PADDING;
      const contentHeight = maxY - minY + 2 * PADDING;

      // Calculate zoom to fit content
      const zoomX = viewportWidth / contentWidth;
      const zoomY = viewportHeight / contentHeight;
      const zoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 1x

      // Calculate center position
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Calculate viewport offset to center the content
      const x = viewportWidth / 2 - centerX * zoom;
      const y = viewportHeight / 2 - centerY * zoom;

      state.viewport = { x, y, zoom };
    });
  },

  zoomIn: () => {
    set((state) => {
      state.viewport.zoom = Math.min(state.viewport.zoom * 1.2, 2);
    });
  },

  zoomOut: () => {
    set((state) => {
      state.viewport.zoom = Math.max(state.viewport.zoom / 1.2, 0.1);
    });
  },

  resetZoom: () => {
    set((state) => {
      state.viewport.zoom = 1;
    });
  },

  setDragging: (isDragging: boolean) => {
    set((state) => {
      state.isDragging = isDragging;
    });
  },

  setPanning: (isPanning: boolean) => {
    set((state) => {
      state.isPanning = isPanning;
    });
  },
});
