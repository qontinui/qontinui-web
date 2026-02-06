/**
 * Auto-layout algorithm tests
 *
 * Comprehensive test suite for workflow graph layout algorithms
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AutoLayout,
  LayoutStyle,
  autoLayoutWorkflow,
} from "../../src/lib/workflow-layout/auto-layout";
import type { Workflow } from "../../src/lib/action-schema/action-types";

describe("AutoLayout", () => {
  let layout: AutoLayout;

  beforeEach(() => {
    layout = new AutoLayout();
  });

  describe("Configuration", () => {
    it("should use default configuration", () => {
      const config = layout.getConfig();
      expect(config.style).toBe(LayoutStyle.HIERARCHICAL);
      expect(config.nodeWidth).toBe(180);
      expect(config.nodeHeight).toBe(80);
      expect(config.horizontalSpacing).toBe(200);
      expect(config.verticalSpacing).toBe(120);
    });

    it("should accept custom configuration", () => {
      const customLayout = new AutoLayout({
        nodeWidth: 200,
        nodeHeight: 100,
        horizontalSpacing: 250,
      });

      const config = customLayout.getConfig();
      expect(config.nodeWidth).toBe(200);
      expect(config.nodeHeight).toBe(100);
      expect(config.horizontalSpacing).toBe(250);
    });

    it("should update configuration", () => {
      layout.updateConfig({ nodeWidth: 250 });
      expect(layout.getConfig().nodeWidth).toBe(250);
    });
  });

  describe("Linear Workflow Layout", () => {
    it("should layout a simple linear workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Linear Flow",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
        },
      };

      layout.layout(workflow);

      // Check that positions are assigned
      expect(workflow.actions[0].position).toBeDefined();
      expect(workflow.actions[1].position).toBeDefined();
      expect(workflow.actions[2].position).toBeDefined();

      // Check that actions are horizontally ordered
      const x1 = workflow.actions[0].position[0];
      const x2 = workflow.actions[1].position[0];
      const x3 = workflow.actions[2].position[0];
      expect(x2).toBeGreaterThan(x1);
      expect(x3).toBeGreaterThan(x2);
    });

    it("should layout single action workflow", () => {
      const workflow: Workflow = {
        id: "wf-single",
        name: "Single Action",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {},
      };

      layout.layout(workflow);

      expect(workflow.actions[0].position).toBeDefined();
      expect(workflow.actions[0].position[0]).toBeGreaterThan(0);
      expect(workflow.actions[0].position[1]).toBeGreaterThan(0);
    });

    it("should handle empty workflow", () => {
      const workflow: Workflow = {
        id: "wf-empty",
        name: "Empty",
        version: "1.0.0",
        format: "graph",
        actions: [],
        connections: {},
      };

      expect(() => layout.layout(workflow)).not.toThrow();
    });
  });

  describe("Branching Workflows - IF", () => {
    it("should layout IF branch correctly", () => {
      const workflow: Workflow = {
        id: "wf-if",
        name: "IF Flow",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "if1",
            type: "IF",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          }, // True branch
          {
            id: "a3",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          }, // False branch
          {
            id: "a4",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "if1", type: "main", index: 0 }]] },
          if1: {
            main: [
              [{ action: "a2", type: "main", index: 0 }], // True
              [{ action: "a3", type: "main", index: 0 }], // False
            ],
          },
          a2: { main: [[{ action: "a4", type: "main", index: 0 }]] },
          a3: { main: [[{ action: "a4", type: "main", index: 0 }]] },
        },
      };

      layout.layout(workflow);

      const ifAction = workflow.actions[1];
      const trueBranch = workflow.actions[2];
      const falseBranch = workflow.actions[3];

      // True and false branches should be vertically separated
      expect(
        Math.abs(trueBranch.position[1] - falseBranch.position[1])
      ).toBeGreaterThan(50);

      // One should be above IF, one below
      const ifY = ifAction.position[1];
      const hasAbove =
        trueBranch.position[1] < ifY || falseBranch.position[1] < ifY;
      const hasBelow =
        trueBranch.position[1] > ifY || falseBranch.position[1] > ifY;
      expect(hasAbove && hasBelow).toBe(true);
    });

    it("should layout nested IF branches", () => {
      const workflow: Workflow = {
        id: "wf-nested-if",
        name: "Nested IF",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "if1",
            type: "IF",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "if2",
            type: "IF",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          if1: {
            main: [
              [{ action: "if2", type: "main", index: 0 }],
              [{ action: "a3", type: "main", index: 0 }],
            ],
          },
          if2: {
            main: [
              [{ action: "a1", type: "main", index: 0 }],
              [{ action: "a2", type: "main", index: 0 }],
            ],
          },
        },
      };

      layout.layout(workflow);

      // All actions should have positions
      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
        expect(action.position[0]).toBeGreaterThan(-1000);
        expect(action.position[1]).toBeGreaterThan(-1000);
      });
    });
  });

  describe("LOOP Layout", () => {
    it("should layout LOOP correctly", () => {
      const workflow: Workflow = {
        id: "wf-loop",
        name: "Loop Flow",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "loop1",
            type: "LOOP",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "loop1", type: "main", index: 0 }]] },
          loop1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
        },
      };

      layout.layout(workflow);

      // All actions should have valid positions
      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
        expect(Array.isArray(action.position)).toBe(true);
        expect(action.position.length).toBe(2);
      });
    });
  });

  describe("SWITCH Layout", () => {
    it("should layout SWITCH with multiple branches", () => {
      const workflow: Workflow = {
        id: "wf-switch",
        name: "Switch Flow",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "switch1",
            type: "SWITCH",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "default",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          switch1: {
            main: [
              [{ action: "a1", type: "main", index: 0 }], // Case 1
              [{ action: "a2", type: "main", index: 0 }], // Case 2
              [{ action: "a3", type: "main", index: 0 }], // Case 3
              [{ action: "default", type: "main", index: 0 }], // Default
            ],
          },
        },
      };

      layout.layout(workflow);

      // All branches should be vertically separated
      const branches = [
        workflow.actions[1],
        workflow.actions[2],
        workflow.actions[3],
        workflow.actions[4],
      ];
      const yPositions = branches.map((a) => a.position[1]);

      // Check that positions are spread out
      const minY = Math.min(...yPositions);
      const maxY = Math.max(...yPositions);
      expect(maxY - minY).toBeGreaterThan(100);
    });
  });

  describe("Overlap Reduction", () => {
    it("should reduce overlaps in complex graph", () => {
      const workflow: Workflow = {
        id: "wf-overlap",
        name: "Overlap Test",
        version: "1.0.0",
        format: "graph",
        actions: Array.from({ length: 10 }, (_, i) => ({
          id: `a${i}`,
          type: "CLICK" as const,
          config: {} as Record<string, unknown>,
          position: [0, 0] as [number, number],
        })),
        connections: {},
      };

      layout.layout(workflow);

      // Check that no two actions overlap
      for (let i = 0; i < workflow.actions.length; i++) {
        for (let j = i + 1; j < workflow.actions.length; j++) {
          const a1 = workflow.actions[i];
          const a2 = workflow.actions[j];

          const [x1, y1] = a1.position;
          const [x2, y2] = a2.position;

          const dx = Math.abs(x1 - x2);
          const dy = Math.abs(y1 - y2);

          // Should not be too close
          const minDistance = 20;
          const distance = Math.sqrt(dx * dx + dy * dy);
          expect(distance).toBeGreaterThan(minDistance);
        }
      }
    });
  });

  describe("Layout Styles", () => {
    let workflow: Workflow;

    beforeEach(() => {
      workflow = {
        id: "wf-styles",
        name: "Style Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a4",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: {
            main: [
              [{ action: "a3", type: "main", index: 0 }],
              [{ action: "a4", type: "main", index: 0 }],
            ],
          },
        },
      };
    });

    it("should layout with HIERARCHICAL style", () => {
      layout.layout(workflow, LayoutStyle.HIERARCHICAL);

      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });
    });

    it("should layout with HORIZONTAL style", () => {
      layout.layout(workflow, LayoutStyle.HORIZONTAL);

      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });
    });

    it("should layout with TREE style", () => {
      layout.layout(workflow, LayoutStyle.TREE);

      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });
    });

    it("should layout with FORCE_DIRECTED style", () => {
      layout.layout(workflow, LayoutStyle.FORCE_DIRECTED);

      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });
    });

    it("should layout with CIRCULAR style", () => {
      layout.layout(workflow, LayoutStyle.CIRCULAR);

      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });

      // Check that nodes are roughly in a circle
      const centerX =
        workflow.actions.reduce((sum, a) => sum + a.position[0], 0) /
        workflow.actions.length;
      const centerY =
        workflow.actions.reduce((sum, a) => sum + a.position[1], 0) /
        workflow.actions.length;

      const distances = workflow.actions.map((a) => {
        const dx = a.position[0] - centerX;
        const dy = a.position[1] - centerY;
        return Math.sqrt(dx * dx + dy * dy);
      });

      // All distances should be similar (within 20% of average)
      const avgDistance =
        distances.reduce((sum, d) => sum + d, 0) / distances.length;
      distances.forEach((d) => {
        expect(Math.abs(d - avgDistance) / avgDistance).toBeLessThan(0.2);
      });
    });
  });

  describe("Complex Graph Structures", () => {
    it("should layout diamond pattern", () => {
      const workflow: Workflow = {
        id: "wf-diamond",
        name: "Diamond Pattern",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "start",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "branch1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "branch2",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "merge",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          start: {
            main: [
              [{ action: "branch1", type: "main", index: 0 }],
              [{ action: "branch2", type: "main", index: 0 }],
            ],
          },
          branch1: { main: [[{ action: "merge", type: "main", index: 0 }]] },
          branch2: { main: [[{ action: "merge", type: "main", index: 0 }]] },
        },
      };

      layout.layout(workflow);

      // Check layout is reasonable
      const start = workflow.actions.find((a) => a.id === "start")!;
      const merge = workflow.actions.find((a) => a.id === "merge")!;
      const branch1 = workflow.actions.find((a) => a.id === "branch1")!;
      const branch2 = workflow.actions.find((a) => a.id === "branch2")!;

      // Merge should be to the right of start
      expect(merge.position[0]).toBeGreaterThan(start.position[0]);

      // Branches should be at same X level
      expect(Math.abs(branch1.position[0] - branch2.position[0])).toBeLessThan(
        50
      );

      // Branches should be vertically separated
      expect(
        Math.abs(branch1.position[1] - branch2.position[1])
      ).toBeGreaterThan(50);
    });

    it("should layout graph with cycle (detected)", () => {
      const workflow: Workflow = {
        id: "wf-cycle",
        name: "Cycle Graph",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
          a3: { main: [[{ action: "a1", type: "main", index: 0 }]] }, // Back to start
        },
      };

      // Should handle gracefully without infinite loop
      expect(() => layout.layout(workflow)).not.toThrow();

      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });
    });

    it("should layout multiple entry points", () => {
      const workflow: Workflow = {
        id: "wf-multi-entry",
        name: "Multiple Entries",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "entry1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "entry2",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a1",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          entry1: { main: [[{ action: "a1", type: "main", index: 0 }]] },
          entry2: { main: [[{ action: "a2", type: "main", index: 0 }]] },
        },
      };

      layout.layout(workflow);

      // Both entries should be at X=0 layer
      const entry1 = workflow.actions.find((a) => a.id === "entry1")!;
      const entry2 = workflow.actions.find((a) => a.id === "entry2")!;

      expect(Math.abs(entry1.position[0] - entry2.position[0])).toBeLessThan(
        50
      );
    });

    it("should layout large workflow efficiently", () => {
      // Create a large workflow with 100 actions
      const actions = Array.from({ length: 100 }, (_, i) => ({
        id: `action-${i}`,
        type: "CLICK" as const,
        config: {} as Record<string, unknown>,
        position: [0, 0] as [number, number],
      }));

      const connections: Record<
        string,
        { main: { action: string; type: string; index: number }[][] }
      > = {};
      for (let i = 0; i < 99; i++) {
        connections[`action-${i}`] = {
          main: [[{ action: `action-${i + 1}`, type: "main", index: 0 }]],
        };
      }

      const workflow: Workflow = {
        id: "wf-large",
        name: "Large Workflow",
        version: "1.0.0",
        format: "graph",
        actions,
        connections,
      };

      const startTime = Date.now();
      layout.layout(workflow);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);

      // All actions should have positions
      workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
      });
    });
  });

  describe("Center Alignment", () => {
    it("should center graph at default point", () => {
      const workflow: Workflow = {
        id: "wf-center",
        name: "Center Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a3",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
        },
      };

      layout.layout(workflow);

      // Calculate center
      const avgX =
        workflow.actions.reduce((sum, a) => sum + a.position[0], 0) / 3;
      const avgY =
        workflow.actions.reduce((sum, a) => sum + a.position[1], 0) / 3;

      // Should be close to default center point [400, 300]
      expect(Math.abs(avgX - 400)).toBeLessThan(200);
      expect(Math.abs(avgY - 300)).toBeLessThan(200);
    });

    it("should center graph at custom point", () => {
      const customLayout = new AutoLayout({ centerPoint: [500, 500] });

      const workflow: Workflow = {
        id: "wf-custom-center",
        name: "Custom Center",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
        },
      };

      customLayout.layout(workflow);

      const avgX =
        workflow.actions.reduce((sum, a) => sum + a.position[0], 0) / 2;
      const avgY =
        workflow.actions.reduce((sum, a) => sum + a.position[1], 0) / 2;

      expect(Math.abs(avgX - 500)).toBeLessThan(200);
      expect(Math.abs(avgY - 500)).toBeLessThan(200);
    });
  });

  describe("Convenience Function", () => {
    it("should work with autoLayoutWorkflow function", () => {
      const workflow: Workflow = {
        id: "wf-convenience",
        name: "Convenience Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
          {
            id: "a2",
            type: "TYPE",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
        },
      };

      autoLayoutWorkflow(workflow);

      expect(workflow.actions[0].position).toBeDefined();
      expect(workflow.actions[1].position).toBeDefined();
    });

    it("should accept custom config in convenience function", () => {
      const workflow: Workflow = {
        id: "wf-convenience-config",
        name: "Convenience Config Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          {
            id: "a1",
            type: "CLICK",
            config: {} as Record<string, unknown>,
            position: [0, 0],
          },
        ],
        connections: {},
      };

      autoLayoutWorkflow(workflow, { nodeWidth: 300 }, LayoutStyle.CIRCULAR);

      expect(workflow.actions[0].position).toBeDefined();
    });
  });
});
