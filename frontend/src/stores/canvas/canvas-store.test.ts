/**
 * Canvas Store Tests
 *
 * Demonstrates testing individual slices independently
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Action, Workflow } from "./types";
import { createWorkflowSlice } from "./workflow-slice";
import { createActionSlice } from "./action-slice";
import { createSelectionSlice } from "./selection-slice";
import { createHistorySlice } from "./history-slice";
import { createViewportSlice } from "./viewport-slice";
import { createPreferencesSlice } from "./preferences-slice";

// ============================================================================
// Test Helpers
// ============================================================================

const createMockAction = (id: string, type = "http-request"): Action => ({
  id,
  type,
  position: [100, 100],
  config: {},
  inputs: [],
  outputs: [],
});

const createMockWorkflow = (): Workflow => ({
  id: "test-workflow",
  name: "Test Workflow",
  description: "Test",
  actions: [],
  connections: {},
  variables: {},
  version: "1.0",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// ============================================================================
// Workflow Slice Tests
// ============================================================================

describe("WorkflowSlice", () => {
  it("should set workflow", () => {
    const useStore = create(immer(createWorkflowSlice as unknown));
    const workflow = createMockWorkflow();

    useStore.getState().setWorkflow(workflow);

    expect(useStore.getState().workflow).toEqual(workflow);
    expect(useStore.getState().isDirty).toBe(false);
  });

  it("should clear workflow", () => {
    const useStore = create(immer(createWorkflowSlice as unknown));
    const workflow = createMockWorkflow();

    useStore.getState().setWorkflow(workflow);
    useStore.getState().clearWorkflow();

    expect(useStore.getState().workflow).toBeNull();
    expect(useStore.getState().isDirty).toBe(false);
  });

  it("should validate workflow", async () => {
    const useStore = create(immer(createWorkflowSlice as unknown));
    const workflow = createMockWorkflow();

    useStore.getState().setWorkflow(workflow);
    const result = await useStore.getState().validateWorkflow();

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("warnings");
  });
});

// ============================================================================
// Action Slice Tests
// ============================================================================

describe("ActionSlice", () => {
  let useStore: unknown;

  beforeEach(() => {
    // Create a combined store with workflow and action slices for testing
    useStore = create(
      immer((...a) => ({
        ...createWorkflowSlice(...a),
        ...createActionSlice(...a),
        ...createHistorySlice(...a),
      }))
    );

    const workflow = createMockWorkflow();
    useStore.getState().setWorkflow(workflow);
  });

  it("should add action", () => {
    const action = createMockAction("action-1");

    useStore.getState().addAction(action);

    expect(useStore.getState().workflow?.actions).toHaveLength(1);
    expect(useStore.getState().workflow?.actions[0]).toEqual(action);
    expect(useStore.getState().isDirty).toBe(true);
  });

  it("should update action", () => {
    const action = createMockAction("action-1");
    useStore.getState().addAction(action);

    useStore.getState().updateAction("action-1", { position: [200, 200] });

    expect(useStore.getState().workflow?.actions[0].position).toEqual([
      200, 200,
    ]);
  });

  it("should delete action", () => {
    const action = createMockAction("action-1");
    useStore.getState().addAction(action);

    useStore.getState().deleteAction("action-1");

    expect(useStore.getState().workflow?.actions).toHaveLength(0);
  });

  it("should delete multiple actions", () => {
    useStore.getState().addAction(createMockAction("action-1"));
    useStore.getState().addAction(createMockAction("action-2"));
    useStore.getState().addAction(createMockAction("action-3"));

    useStore.getState().deleteActions(["action-1", "action-3"]);

    expect(useStore.getState().workflow?.actions).toHaveLength(1);
    expect(useStore.getState().workflow?.actions[0].id).toBe("action-2");
  });

  it("should get action by id", () => {
    const action = createMockAction("action-1");
    useStore.getState().addAction(action);

    const found = useStore.getState().getActionById("action-1");

    expect(found).toEqual(action);
  });

  it("should find actions by type", () => {
    useStore.getState().addAction(createMockAction("action-1", "http-request"));
    useStore.getState().addAction(createMockAction("action-2", "database"));
    useStore.getState().addAction(createMockAction("action-3", "http-request"));

    const httpActions = useStore.getState().findActionsByType("http-request");

    expect(httpActions).toHaveLength(2);
    expect(httpActions.map((a: Action) => a.id)).toEqual([
      "action-1",
      "action-3",
    ]);
  });
});

// ============================================================================
// Selection Slice Tests
// ============================================================================

describe("SelectionSlice", () => {
  let useStore: unknown;

  beforeEach(() => {
    useStore = create(
      immer((...a) => ({
        ...createWorkflowSlice(...a),
        ...createActionSlice(...a),
        ...createSelectionSlice(...a),
        ...createHistorySlice(...a),
      }))
    );

    const workflow = createMockWorkflow();
    useStore.getState().setWorkflow(workflow);
    useStore.getState().addAction(createMockAction("action-1"));
    useStore.getState().addAction(createMockAction("action-2"));
    useStore.getState().addAction(createMockAction("action-3"));
  });

  it("should select node", () => {
    useStore.getState().selectNode("action-1");

    expect(useStore.getState().selectedNodes).toEqual(["action-1"]);
  });

  it("should multi-select nodes", () => {
    useStore.getState().selectNode("action-1");
    useStore.getState().selectNode("action-2", true);

    expect(useStore.getState().selectedNodes).toEqual(["action-1", "action-2"]);
  });

  it("should toggle selection in multi mode", () => {
    useStore.getState().selectNode("action-1");
    useStore.getState().selectNode("action-2", true);
    useStore.getState().selectNode("action-2", true); // Toggle off

    expect(useStore.getState().selectedNodes).toEqual(["action-1"]);
  });

  it("should select all", () => {
    useStore.getState().selectAll();

    expect(useStore.getState().selectedNodes).toHaveLength(3);
    expect(useStore.getState().selectedNodes).toEqual([
      "action-1",
      "action-2",
      "action-3",
    ]);
  });

  it("should invert selection", () => {
    useStore.getState().selectNode("action-1");
    useStore.getState().invertSelection();

    expect(useStore.getState().selectedNodes).toEqual(["action-2", "action-3"]);
  });

  it("should clear selection", () => {
    useStore.getState().selectNode("action-1");
    useStore.getState().selectNode("action-2", true);
    useStore.getState().clearSelection();

    expect(useStore.getState().selectedNodes).toEqual([]);
  });
});

// ============================================================================
// History Slice Tests
// ============================================================================

describe("HistorySlice", () => {
  let useStore: unknown;

  beforeEach(() => {
    useStore = create(
      immer((...a) => ({
        ...createWorkflowSlice(...a),
        ...createActionSlice(...a),
        ...createHistorySlice(...a),
      }))
    );

    const workflow = createMockWorkflow();
    useStore.getState().setWorkflow(workflow);
  });

  it("should record history", () => {
    const initialHistoryLength = useStore.getState().history.length;

    useStore.getState().addAction(createMockAction("action-1"));

    expect(useStore.getState().history.length).toBeGreaterThan(
      initialHistoryLength
    );
  });

  it("should undo", () => {
    useStore.getState().addAction(createMockAction("action-1"));
    const actionsAfterAdd = useStore.getState().workflow?.actions.length;

    useStore.getState().undo();

    expect(useStore.getState().workflow?.actions.length).toBeLessThan(
      actionsAfterAdd
    );
  });

  it("should redo", () => {
    useStore.getState().addAction(createMockAction("action-1"));
    useStore.getState().undo();
    const actionsAfterUndo = useStore.getState().workflow?.actions.length;

    useStore.getState().redo();

    expect(useStore.getState().workflow?.actions.length).toBeGreaterThan(
      actionsAfterUndo
    );
  });

  it("should check canUndo", () => {
    expect(useStore.getState().canUndo()).toBe(true); // After setWorkflow
  });

  it("should check canRedo", () => {
    expect(useStore.getState().canRedo()).toBe(false);

    useStore.getState().addAction(createMockAction("action-1"));
    useStore.getState().undo();

    expect(useStore.getState().canRedo()).toBe(true);
  });
});

// ============================================================================
// Viewport Slice Tests
// ============================================================================

describe("ViewportSlice", () => {
  let useStore: unknown;

  beforeEach(() => {
    useStore = create(immer(createViewportSlice as unknown));
  });

  it("should set viewport", () => {
    useStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 });

    expect(useStore.getState().viewport).toEqual({ x: 100, y: 200, zoom: 1.5 });
  });

  it("should zoom in", () => {
    const initialZoom = useStore.getState().viewport.zoom;

    useStore.getState().zoomIn();

    expect(useStore.getState().viewport.zoom).toBeGreaterThan(initialZoom);
  });

  it("should zoom out", () => {
    useStore.getState().setViewport({ zoom: 1.5 });

    useStore.getState().zoomOut();

    expect(useStore.getState().viewport.zoom).toBeLessThan(1.5);
  });

  it("should reset zoom", () => {
    useStore.getState().setViewport({ zoom: 1.5 });

    useStore.getState().resetZoom();

    expect(useStore.getState().viewport.zoom).toBe(1);
  });

  it("should set dragging state", () => {
    useStore.getState().setDragging(true);

    expect(useStore.getState().isDragging).toBe(true);
  });

  it("should set panning state", () => {
    useStore.getState().setPanning(true);

    expect(useStore.getState().isPanning).toBe(true);
  });
});

// ============================================================================
// Preferences Slice Tests
// ============================================================================

describe("PreferencesSlice", () => {
  let useStore: unknown;

  beforeEach(() => {
    useStore = create(immer(createPreferencesSlice as unknown));
  });

  it("should toggle minimap", () => {
    const initial = useStore.getState().showMinimap;

    useStore.getState().toggleMinimap();

    expect(useStore.getState().showMinimap).toBe(!initial);
  });

  it("should toggle grid", () => {
    const initial = useStore.getState().showGrid;

    useStore.getState().toggleGrid();

    expect(useStore.getState().showGrid).toBe(!initial);
  });

  it("should toggle snap to grid", () => {
    const initial = useStore.getState().snapToGrid;

    useStore.getState().toggleSnapToGrid();

    expect(useStore.getState().snapToGrid).toBe(!initial);
  });

  it("should set grid size", () => {
    useStore.getState().setGridSize(30);

    expect(useStore.getState().gridSize).toBe(30);
  });
});
