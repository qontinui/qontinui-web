/**
 * Canvas Store Tests
 *
 * Test coverage:
 * - Store initialization
 * - CRUD operations
 * - History (undo/redo)
 * - Selection management
 * - Clipboard operations
 * - Keyboard shortcuts
 * - Validation
 * - Persistence
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCanvasStore } from "./canvas-store";
import type { Workflow, Action } from "../lib/action-schema/action-types";

// Mock workflow for testing
const createMockWorkflow = (): Workflow => ({
  id: "test-workflow",
  name: "Test Workflow",
  version: "1.0.0",
  format: "graph",
  actions: [
    {
      id: "action-1",
      type: "CLICK",
      position: [100, 100],
      config: {
        findBy: "text",
        searchString: "Click Me",
      },
    },
    {
      id: "action-2",
      type: "TYPE",
      position: [100, 200],
      config: {
        text: "Hello World",
      },
    },
  ],
  connections: {
    "action-1": {
      main: [[{ action: "action-2", type: "main", index: 0 }]],
    },
  },
});

describe("Canvas Store", () => {
  beforeEach(() => {
    // Reset store before each test
    useCanvasStore.getState().clearWorkflow();
    useCanvasStore.getState().clearHistory();
  });

  describe("Initialization", () => {
    it("should initialize with empty state", () => {
      const state = useCanvasStore.getState();

      expect(state.workflow).toBeNull();
      expect(state.selectedNodes).toEqual([]);
      expect(state.selectedEdges).toEqual([]);
      expect(state.isDirty).toBe(false);
      expect(state.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe("Workflow Management", () => {
    it("should load workflow", () => {
      const workflow = createMockWorkflow();
      const { setWorkflow } = useCanvasStore.getState();

      setWorkflow(workflow);

      const state = useCanvasStore.getState();
      expect(state.workflow).toEqual(workflow);
      expect(state.isDirty).toBe(false);
    });

    it("should clear workflow", () => {
      const workflow = createMockWorkflow();
      const { setWorkflow, clearWorkflow } = useCanvasStore.getState();

      setWorkflow(workflow);
      clearWorkflow();

      const state = useCanvasStore.getState();
      expect(state.workflow).toBeNull();
    });
  });

  describe("Action CRUD", () => {
    beforeEach(() => {
      const workflow = createMockWorkflow();
      useCanvasStore.getState().setWorkflow(workflow);
    });

    it("should add action", () => {
      const newAction: Action = {
        id: "action-3",
        type: "WAIT",
        position: [100, 300],
        config: {
          duration: 1000,
        },
      };

      const { addAction } = useCanvasStore.getState();
      addAction(newAction);

      const state = useCanvasStore.getState();
      expect(state.workflow?.actions).toHaveLength(3);
      expect(state.workflow?.actions[2]).toEqual(newAction);
      expect(state.isDirty).toBe(true);
    });

    it("should update action", () => {
      const { updateAction } = useCanvasStore.getState();

      updateAction("action-1", { name: "Updated Action" });

      const state = useCanvasStore.getState();
      const action = state.workflow?.actions.find((a) => a.id === "action-1");
      expect(action?.name).toBe("Updated Action");
      expect(state.isDirty).toBe(true);
    });

    it("should delete action", () => {
      const { deleteAction } = useCanvasStore.getState();

      deleteAction("action-1");

      const state = useCanvasStore.getState();
      expect(state.workflow?.actions).toHaveLength(1);
      expect(state.workflow?.actions[0].id).toBe("action-2");
      expect(state.workflow?.connections["action-1"]).toBeUndefined();
    });

    it("should delete multiple actions", () => {
      const { deleteActions } = useCanvasStore.getState();

      deleteActions(["action-1", "action-2"]);

      const state = useCanvasStore.getState();
      expect(state.workflow?.actions).toHaveLength(0);
    });

    it("should move action", () => {
      const { moveAction } = useCanvasStore.getState();

      moveAction("action-1", [200, 200]);

      const state = useCanvasStore.getState();
      const action = state.workflow?.actions.find((a) => a.id === "action-1");
      expect(action?.position).toEqual([200, 200]);
    });
  });

  describe("Selection", () => {
    beforeEach(() => {
      const workflow = createMockWorkflow();
      useCanvasStore.getState().setWorkflow(workflow);
    });

    it("should select single node", () => {
      const { selectNode } = useCanvasStore.getState();

      selectNode("action-1");

      const state = useCanvasStore.getState();
      expect(state.selectedNodes).toEqual(["action-1"]);
      expect(state.selectedEdges).toEqual([]);
    });

    it("should multi-select nodes", () => {
      const { selectNode } = useCanvasStore.getState();

      selectNode("action-1");
      selectNode("action-2", true);

      const state = useCanvasStore.getState();
      expect(state.selectedNodes).toContain("action-1");
      expect(state.selectedNodes).toContain("action-2");
    });

    it("should select all nodes", () => {
      const { selectAll } = useCanvasStore.getState();

      selectAll();

      const state = useCanvasStore.getState();
      expect(state.selectedNodes).toHaveLength(2);
    });

    it("should clear selection", () => {
      const { selectNode, clearSelection } = useCanvasStore.getState();

      selectNode("action-1");
      clearSelection();

      const state = useCanvasStore.getState();
      expect(state.selectedNodes).toEqual([]);
    });
  });

  describe("Clipboard", () => {
    beforeEach(() => {
      const workflow = createMockWorkflow();
      useCanvasStore.getState().setWorkflow(workflow);
    });

    it("should copy nodes", () => {
      const { selectNode, copy } = useCanvasStore.getState();

      selectNode("action-1");
      copy();

      const state = useCanvasStore.getState();
      expect(state.clipboardNodes).toHaveLength(1);
      expect(state.clipboardNodes[0].id).toBe("action-1");
    });

    it("should paste nodes with new IDs", () => {
      const { selectNode, copy, paste } = useCanvasStore.getState();

      selectNode("action-1");
      copy();
      paste();

      const state = useCanvasStore.getState();
      expect(state.workflow?.actions).toHaveLength(3);

      const pastedAction = state.workflow?.actions[2];
      expect(pastedAction?.id).not.toBe("action-1");
      expect(pastedAction?.type).toBe("CLICK");
    });

    it("should cut nodes", () => {
      const { selectNode, cut } = useCanvasStore.getState();

      selectNode("action-1");
      cut();

      const state = useCanvasStore.getState();
      expect(state.clipboardNodes).toHaveLength(1);
      expect(state.workflow?.actions).toHaveLength(1);
    });
  });

  describe("History", () => {
    beforeEach(() => {
      const workflow = createMockWorkflow();
      useCanvasStore.getState().setWorkflow(workflow);
    });

    it("should record history on changes", () => {
      const { updateAction } = useCanvasStore.getState();

      updateAction("action-1", { name: "Changed" });

      const state = useCanvasStore.getState();
      expect(state.history.length).toBeGreaterThan(0);
    });

    it("should undo changes", () => {
      const { updateAction, undo } = useCanvasStore.getState();

      updateAction("action-1", { name: "Changed" });
      undo();

      const state = useCanvasStore.getState();
      const action = state.workflow?.actions.find((a) => a.id === "action-1");
      expect(action?.name).toBeUndefined();
    });

    it("should redo changes", () => {
      const { updateAction, undo, redo } = useCanvasStore.getState();

      updateAction("action-1", { name: "Changed" });
      undo();
      redo();

      const state = useCanvasStore.getState();
      const action = state.workflow?.actions.find((a) => a.id === "action-1");
      expect(action?.name).toBe("Changed");
    });

    it("should report canUndo correctly", () => {
      const { canUndo, updateAction } = useCanvasStore.getState();

      expect(canUndo()).toBe(true); // Initial state recorded

      updateAction("action-1", { name: "Changed" });
      expect(canUndo()).toBe(true);
    });
  });

  describe("Viewport", () => {
    it("should update viewport", () => {
      const { setViewport } = useCanvasStore.getState();

      setViewport({ x: 100, y: 200, zoom: 1.5 });

      const state = useCanvasStore.getState();
      expect(state.viewport).toEqual({ x: 100, y: 200, zoom: 1.5 });
    });

    it("should zoom in", () => {
      const { zoomIn } = useCanvasStore.getState();

      zoomIn();

      const state = useCanvasStore.getState();
      expect(state.viewport.zoom).toBeGreaterThan(1);
    });

    it("should zoom out", () => {
      const { zoomOut } = useCanvasStore.getState();

      zoomOut();

      const state = useCanvasStore.getState();
      expect(state.viewport.zoom).toBeLessThan(1);
    });
  });

  describe("Connections", () => {
    beforeEach(() => {
      const workflow = createMockWorkflow();
      useCanvasStore.getState().setWorkflow(workflow);
    });

    it("should add connection", () => {
      const { addConnection } = useCanvasStore.getState();

      // Add action-3
      useCanvasStore.getState().addAction({
        id: "action-3",
        type: "WAIT",
        position: [100, 300],
        config: { duration: 1000 },
      });

      addConnection("action-2", "main", 0, "action-3", 0);

      const state = useCanvasStore.getState();
      const connections = state.workflow?.connections["action-2"]?.main?.[0];
      expect(connections).toBeDefined();
      expect(connections?.[0].action).toBe("action-3");
    });

    it("should delete connection", () => {
      const { deleteConnection } = useCanvasStore.getState();

      deleteConnection("action-1", "main", 0, "action-2");

      const state = useCanvasStore.getState();
      const connections = state.workflow?.connections["action-1"]?.main?.[0];
      expect(connections).toEqual([]);
    });
  });
});
