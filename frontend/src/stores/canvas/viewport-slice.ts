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
> = (set, get) => ({
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
    // TODO: Implement actual fitView based on action positions
    set((state) => {
      state.viewport = { x: 0, y: 0, zoom: 1 };
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
