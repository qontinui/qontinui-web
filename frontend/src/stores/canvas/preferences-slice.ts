/**
 * Preferences Slice - Manages UI preferences and settings
 *
 * Responsibilities:
 * - Grid settings (show, snap, size)
 * - Minimap visibility
 * - Other UI preferences
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, PreferencesSlice } from "./types";

export const createPreferencesSlice: StateCreator<
  CanvasStore,
  [["zustand/immer", never]],
  [],
  PreferencesSlice
> = (set) => ({
  // State
  showMinimap: true,
  showGrid: true,
  snapToGrid: true,
  gridSize: 20,

  // Actions
  toggleMinimap: () => {
    set((state) => {
      state.showMinimap = !state.showMinimap;
    });
  },

  toggleGrid: () => {
    set((state) => {
      state.showGrid = !state.showGrid;
    });
  },

  toggleSnapToGrid: () => {
    set((state) => {
      state.snapToGrid = !state.snapToGrid;
    });
  },

  setGridSize: (size: number) => {
    set((state) => {
      state.gridSize = size;
    });
  },
});
