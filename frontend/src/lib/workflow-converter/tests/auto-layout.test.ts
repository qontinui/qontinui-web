/**
 * Tests for Auto-Layout Algorithm
 *
 * Tests for automatic positioning of actions in graph workflows.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AutoLayout, layoutActions } from "../auto-layout";
import { Action, Connections } from "../../action-schema/action-types";
import { ClickActionConfig } from "../../action-schema/configs/mouse-actions";

describe("AutoLayout", () => {
  let layout: AutoLayout;

  beforeEach(() => {
    layout = new AutoLayout();
  });

  describe("Basic Layout", () => {
    it("should layout empty action list", () => {
      const actions: Action[] = [];
      const connections: Connections = {};

      layout.layout(actions, connections);

      expect(actions).toHaveLength(0);
    });

    it("should layout single action", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];
      const connections: Connections = {};

      layout.layout(actions, connections);

      expect(actions[0].position).toBeDefined();
      expect(actions[0].position[0]).toBeGreaterThanOrEqual(0);
      expect(actions[0].position[1]).toBeGreaterThanOrEqual(0);
    });

    it("should layout linear workflow horizontally", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
        "action-2": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
      };

      layout.layout(actions, connections);

      // Actions should be spaced horizontally
      const x1 = actions[0].position[0];
      const x2 = actions[1].position[0];
      const x3 = actions[2].position[0];

      expect(x2).toBeGreaterThan(x1);
      expect(x3).toBeGreaterThan(x2);
    });
  });

  describe("Custom Options", () => {
    it("should respect horizontal spacing option", () => {
      const layout = new AutoLayout({
        horizontalSpacing: 300,
        startX: 0,
        startY: 0,
      });

      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      };

      layout.layout(actions, connections);

      expect(actions[0].position[0]).toBe(0);
      expect(actions[1].position[0]).toBe(300);
    });

    it("should respect vertical spacing option", () => {
      const layout = new AutoLayout({
        verticalSpacing: 200,
        startX: 0,
        startY: 0,
      });

      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      // No connections - all at same depth
      const connections: Connections = {};

      layout.layout(actions, connections);

      // Should be stacked vertically
      expect(actions[1].position[1]).toBeGreaterThanOrEqual(
        actions[0].position[1]
      );
      expect(actions[2].position[1]).toBeGreaterThanOrEqual(
        actions[1].position[1]
      );
    });

    it("should respect start position options", () => {
      const layout = new AutoLayout({
        startX: 50,
        startY: 100,
      });

      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {};

      layout.layout(actions, connections);

      expect(actions[0].position[0]).toBe(50);
      expect(actions[0].position[1]).toBe(100);
    });
  });

  describe("Branching Layout", () => {
    it("should handle branching (IF action)", () => {
      const actions: Action[] = [
        {
          id: "if-1",
          type: "IF",
          config: {} as unknown,
          position: [0, 0],
        },
        {
          id: "then-action",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "else-action",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        "if-1": {
          main: [
            [{ action: "then-action", type: "main", index: 0 }],
            [{ action: "else-action", type: "main", index: 0 }],
          ],
        },
      };

      layout.layout(actions, connections);

      // Then and else branches should be at same depth (horizontally)
      expect(actions[1].position[0]).toBe(actions[2].position[0]);

      // But different Y positions (vertically separated)
      expect(actions[1].position[1]).not.toBe(actions[2].position[1]);
    });

    it("should handle multiple branches (SWITCH action)", () => {
      const actions: Action[] = [
        {
          id: "switch-1",
          type: "SWITCH",
          config: {} as unknown,
          position: [0, 0],
        },
        {
          id: "case-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "case-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "case-3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        "switch-1": {
          main: [
            [{ action: "case-1", type: "main", index: 0 }],
            [{ action: "case-2", type: "main", index: 0 }],
            [{ action: "case-3", type: "main", index: 0 }],
          ],
        },
      };

      layout.layout(actions, connections);

      // All cases should be at same depth
      expect(actions[1].position[0]).toBe(actions[2].position[0]);
      expect(actions[2].position[0]).toBe(actions[3].position[0]);

      // But different Y positions
      expect(actions[1].position[1]).not.toBe(actions[2].position[1]);
      expect(actions[2].position[1]).not.toBe(actions[3].position[1]);
    });
  });

  describe("Complex Graphs", () => {
    it("should handle diamond pattern (merge)", () => {
      const actions: Action[] = [
        {
          id: "start",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "branch-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "branch-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "merge",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        start: {
          main: [
            [
              { action: "branch-1", type: "main", index: 0 },
              { action: "branch-2", type: "main", index: 0 },
            ],
          ],
        },
        "branch-1": {
          main: [[{ action: "merge", type: "main", index: 0 }]],
        },
        "branch-2": {
          main: [[{ action: "merge", type: "main", index: 0 }]],
        },
      };

      layout.layout(actions, connections);

      // Start should be at depth 0
      const startX = actions[0].position[0];

      // Branches should be at same depth (depth 1)
      expect(actions[1].position[0]).toBe(actions[2].position[0]);
      expect(actions[1].position[0]).toBeGreaterThan(startX);

      // Merge should be after branches (depth 2)
      expect(actions[3].position[0]).toBeGreaterThan(actions[1].position[0]);
    });

    it("should handle parallel execution", () => {
      const actions: Action[] = [
        {
          id: "start",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "parallel-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "parallel-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        start: {
          parallel: [
            [
              { action: "parallel-1", type: "parallel", index: 0 },
              { action: "parallel-2", type: "parallel", index: 0 },
            ],
          ],
        },
      };

      layout.layout(actions, connections);

      // Parallel actions should be at same depth
      expect(actions[1].position[0]).toBe(actions[2].position[0]);

      // But different Y positions
      expect(actions[1].position[1]).not.toBe(actions[2].position[1]);
    });

    it("should handle error paths", () => {
      const actions: Action[] = [
        {
          id: "try",
          type: "TRY_CATCH",
          config: {} as unknown,
          position: [0, 0],
        },
        {
          id: "success",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "error",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        try: {
          success: [[{ action: "success", type: "success", index: 0 }]],
          error: [[{ action: "error", type: "error", index: 0 }]],
        },
      };

      layout.layout(actions, connections);

      // Success and error paths should be at same depth
      expect(actions[1].position[0]).toBe(actions[2].position[0]);

      // But different Y positions
      expect(actions[1].position[1]).not.toBe(actions[2].position[1]);
    });
  });

  describe("Depth Calculation", () => {
    it("should calculate correct depth for linear workflow", () => {
      const actions: Action[] = [
        {
          id: "a1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "a2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "a3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        a1: {
          main: [[{ action: "a2", type: "main", index: 0 }]],
        },
        a2: {
          main: [[{ action: "a3", type: "main", index: 0 }]],
        },
      };

      layout.layout(actions, connections);

      // Each action should be further right than the previous
      expect(actions[0].position[0]).toBeLessThan(actions[1].position[0]);
      expect(actions[1].position[0]).toBeLessThan(actions[2].position[0]);
    });

    it("should handle nodes with no parents (entry points)", () => {
      const actions: Action[] = [
        {
          id: "entry-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "entry-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {};

      layout.layout(actions, connections);

      // Both should be at same depth (entry points)
      expect(actions[0].position[0]).toBe(actions[1].position[0]);
    });
  });

  describe("findOptimalPosition", () => {
    it("should return start position for empty action list", () => {
      const position = layout.findOptimalPosition([]);

      expect(position[0]).toBeGreaterThanOrEqual(0);
      expect(position[1]).toBeGreaterThanOrEqual(0);
    });

    it("should find position that does not overlap existing actions", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [100, 100],
        },
      ];

      const position = layout.findOptimalPosition(actions);

      // Should not be at same position as existing action
      expect(position[0]).not.toBe(100);
    });

    it("should place new node to the right", () => {
      const layout = new AutoLayout({
        horizontalSpacing: 200,
        startX: 100,
      });

      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [100, 100],
        },
      ];

      const position = layout.findOptimalPosition(actions);

      expect(position[0]).toBe(300); // 100 + 200
    });
  });

  describe("Convenience Function", () => {
    it("should work with layoutActions function", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      };

      layoutActions(actions, connections, {
        horizontalSpacing: 250,
      });

      expect(actions[0].position).toBeDefined();
      expect(actions[1].position).toBeDefined();
      expect(actions[1].position[0]).toBeGreaterThan(actions[0].position[0]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle disconnected actions", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const connections: Connections = {};

      layout.layout(actions, connections);

      // Both should be positioned even without connections
      expect(actions[0].position).toBeDefined();
      expect(actions[1].position).toBeDefined();
    });

    it("should handle single action with self-connection", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "LOOP",
          config: {} as unknown,
          position: [0, 0],
        },
      ];

      const connections: Connections = {
        "action-1": {
          main: [[{ action: "action-1", type: "main", index: 0 }]],
        },
      };

      layout.layout(actions, connections);

      expect(actions[0].position).toBeDefined();
    });
  });
});
