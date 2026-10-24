/**
 * Canvas store persistence contract.
 *
 * Users' saved canvas preferences live in localStorage under `canvas-storage`.
 * Changing the key or the persisted field set silently drops (or bloats) that
 * stored state, so both are pinned here.
 */

import { describe, it, expect } from "vitest";
import { useCanvasStore } from "./index";

const PERSISTED_FIELDS = [
  "gridSize",
  "showGrid",
  "showMinimap",
  "snapToGrid",
  "viewport",
];

describe("canvas store persistence contract", () => {
  it("persists under the canvas-storage key", () => {
    expect(useCanvasStore.persist.getOptions().name).toBe("canvas-storage");
  });

  it("partializes exactly viewport, showMinimap, showGrid, snapToGrid and gridSize", () => {
    const { partialize } = useCanvasStore.persist.getOptions();
    expect(partialize).toBeTypeOf("function");

    const state = useCanvasStore.getState();
    const persisted = partialize!(state) as Record<string, unknown>;

    expect(Object.keys(persisted).sort()).toEqual(PERSISTED_FIELDS);
    expect(persisted.viewport).toEqual(state.viewport);
    expect(persisted.showMinimap).toBe(state.showMinimap);
    expect(persisted.showGrid).toBe(state.showGrid);
    expect(persisted.snapToGrid).toBe(state.snapToGrid);
    expect(persisted.gridSize).toBe(state.gridSize);
  });
});
