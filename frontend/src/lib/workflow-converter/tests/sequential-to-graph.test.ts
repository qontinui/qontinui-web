/**
 * Tests for Sequential to Graph Converter
 *
 * Comprehensive test coverage for workflow conversion, including:
 * - Linear workflows
 * - IF actions
 * - LOOP actions
 * - SWITCH actions
 * - TRY_CATCH actions
 * - Nested control flow
 * - Auto-layout
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SequentialToGraphConverter,
  convertSequentialToGraph,
} from "../sequential-to-graph-converter";
import { Action } from "../../action-schema/action-types";
import { ClickActionConfig } from "../../action-schema/configs/mouse-actions";
import { TypeActionConfig } from "../../action-schema/configs/keyboard-actions";
import {
  IfActionConfig,
  LoopActionConfig,
  SwitchActionConfig,
  TryCatchActionConfig,
} from "../../action-schema/configs/control-flow-actions";

describe("SequentialToGraphConverter", () => {
  let converter: SequentialToGraphConverter;

  beforeEach(() => {
    converter = new SequentialToGraphConverter({
      workflowName: "Test Workflow",
      workflowId: "test-workflow-1",
      preserveActionIds: true, // Preserve IDs so tests can reference actions by original ID
    });
  });

  describe("Basic Conversion", () => {
    it("should convert empty action list", () => {
      const result = converter.convert([]);

      expect(result.workflow.actions).toHaveLength(0);
      expect(result.workflow.format).toBe("graph");
      expect(result.warnings).toContain("Empty action list provided");
      expect(result.stats.actionsConverted).toBe(0);
    });

    it("should convert single action", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          name: "Click Button",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.workflow.actions).toHaveLength(1);
      expect(result.workflow.format).toBe("graph");
      expect(result.workflow.actions[0].position).toBeDefined();
      expect(result.stats.actionsConverted).toBe(1);
      expect(result.stats.connectionsCreated).toBe(0);
    });

    it("should convert linear workflow", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          name: "Click Button",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "TYPE",
          name: "Type Text",
          config: {} as TypeActionConfig,
          position: [0, 0],
        },
        {
          id: "action-3",
          type: "CLICK",
          name: "Submit",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.workflow.actions).toHaveLength(3);
      expect(result.stats.actionsConverted).toBe(3);
      expect(result.stats.connectionsCreated).toBe(2);

      // Check connections
      const connections = result.workflow.connections;
      expect(connections["action-1"].main?.[0][0].action).toBe("action-2");
      expect(connections["action-2"].main?.[0][0].action).toBe("action-3");
    });

    it("should preserve action IDs when option is set", () => {
      const converter = new SequentialToGraphConverter({
        preserveActionIds: true,
      });

      const actions: Action[] = [
        {
          id: "my-custom-id",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.workflow.actions[0].id).toBe("my-custom-id");
    });

    it("should generate new IDs when preserve option is false", () => {
      const converter = new SequentialToGraphConverter({
        preserveActionIds: false,
      });

      const actions: Action[] = [
        {
          id: "original-id",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.workflow.actions[0].id).not.toBe("original-id");
      expect(result.workflow.actions[0].id).toContain("action-");
    });
  });

  describe("Position Assignment", () => {
    it("should assign positions to all actions", () => {
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

      const result = converter.convert(actions);

      result.workflow.actions.forEach((action) => {
        expect(action.position).toBeDefined();
        expect(action.position).toHaveLength(2);
        expect(typeof action.position[0]).toBe("number");
        expect(typeof action.position[1]).toBe("number");
      });
    });

    it("should space actions horizontally", () => {
      const converter = new SequentialToGraphConverter({
        layout: {
          horizontalSpacing: 200,
          startX: 100,
        },
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

      const result = converter.convert(actions);

      // First action should be at startX
      expect(result.workflow.actions[0].position[0]).toBe(100);

      // Second action should be horizontalSpacing away
      expect(result.workflow.actions[1].position[0]).toBe(300);
    });

    it("should respect custom layout options", () => {
      const converter = new SequentialToGraphConverter({
        layout: {
          horizontalSpacing: 250,
          verticalSpacing: 200,
          startX: 50,
          startY: 50,
        },
      });

      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.workflow.actions[0].position[0]).toBe(50);
      expect(result.workflow.actions[0].position[1]).toBe(50);
    });
  });

  describe("IF Action Conversion", () => {
    it("should handle IF action with then branch", () => {
      const actions: Action[] = [
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: {
              type: "expression",
              expression: "x > 5",
            },
            thenActions: ["action-then"],
            elseActions: [],
          } as IfActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.controlFlowExpanded).toBe(1);

      const connections = result.workflow.connections["if-1"];
      expect(connections).toBeDefined();
      expect(connections.main).toBeDefined();
      expect(connections.main?.[0][0].action).toBe("action-then");
    });

    it("should handle IF action with then and else branches", () => {
      const actions: Action[] = [
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: {
              type: "expression",
              expression: "x > 5",
            },
            thenActions: ["action-then"],
            elseActions: ["action-else"],
          } as IfActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      const connections = result.workflow.connections["if-1"];
      expect(connections.main).toBeDefined();
      expect(connections.main).toHaveLength(2);

      // Output 0: then branch
      expect(connections.main?.[0][0].action).toBe("action-then");

      // Output 1: else branch
      expect(connections.main?.[1][0].action).toBe("action-else");
    });

    it("should handle IF action without else branch", () => {
      const actions: Action[] = [
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: {
              type: "expression",
              expression: "x > 5",
            },
            thenActions: ["action-then"],
          } as IfActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      const connections = result.workflow.connections["if-1"];
      expect(connections.main?.[0][0].action).toBe("action-then");
      expect(connections.main).toHaveLength(1); // Only then branch
    });
  });

  describe("LOOP Action Conversion", () => {
    it("should handle FOR loop", () => {
      const actions: Action[] = [
        {
          id: "loop-1",
          type: "LOOP",
          config: {
            loopType: "FOR",
            iterations: 5,
            actions: ["action-body-1", "action-body-2"],
          } as LoopActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.controlFlowExpanded).toBe(1);

      const connections = result.workflow.connections["loop-1"];
      expect(connections).toBeDefined();
      expect(connections.main?.[0][0].action).toBe("action-body-1");
    });

    it("should handle WHILE loop", () => {
      const actions: Action[] = [
        {
          id: "loop-1",
          type: "LOOP",
          config: {
            loopType: "WHILE",
            condition: {
              type: "expression",
              expression: "x < 10",
            },
            actions: ["action-body"],
          } as LoopActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.controlFlowExpanded).toBe(1);

      const connections = result.workflow.connections["loop-1"];
      expect(connections.main?.[0][0].action).toBe("action-body");
    });

    it("should handle FOREACH loop", () => {
      const actions: Action[] = [
        {
          id: "loop-1",
          type: "LOOP",
          config: {
            loopType: "FOREACH",
            collection: {
              type: "variable",
              variableName: "items",
            },
            iteratorVariable: "item",
            actions: ["action-body"],
          } as LoopActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.controlFlowExpanded).toBe(1);
    });
  });

  describe("SWITCH Action Conversion", () => {
    it("should handle SWITCH with multiple cases", () => {
      const actions: Action[] = [
        {
          id: "switch-1",
          type: "SWITCH",
          config: {
            expression: "status",
            cases: [
              { value: "active", actions: ["action-active"] },
              { value: "inactive", actions: ["action-inactive"] },
            ],
            defaultActions: ["action-default"],
          } as SwitchActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.controlFlowExpanded).toBe(1);

      const connections = result.workflow.connections["switch-1"];
      expect(connections.main).toBeDefined();

      // Check case outputs
      expect(connections.main?.[0][0].action).toBe("action-active");
      expect(connections.main?.[1][0].action).toBe("action-inactive");

      // Check default output
      expect(connections.main?.[2][0].action).toBe("action-default");
    });

    it("should handle SWITCH without default case", () => {
      const actions: Action[] = [
        {
          id: "switch-1",
          type: "SWITCH",
          config: {
            expression: "status",
            cases: [{ value: "active", actions: ["action-active"] }],
          } as SwitchActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      const connections = result.workflow.connections["switch-1"];
      expect(connections.main).toBeDefined();
      expect(connections.main).toHaveLength(1);
    });
  });

  describe("TRY_CATCH Action Conversion", () => {
    it("should handle TRY_CATCH with try and catch", () => {
      const actions: Action[] = [
        {
          id: "try-1",
          type: "TRY_CATCH",
          config: {
            tryActions: ["action-try"],
            catchActions: ["action-catch"],
          } as TryCatchActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.controlFlowExpanded).toBe(1);

      const connections = result.workflow.connections["try-1"];
      expect(connections.success?.[0][0].action).toBe("action-try");
      expect(connections.error?.[0][0].action).toBe("action-catch");
    });

    it("should warn about finally actions", () => {
      const actions: Action[] = [
        {
          id: "try-1",
          type: "TRY_CATCH",
          config: {
            tryActions: ["action-try"],
            catchActions: ["action-catch"],
            finallyActions: ["action-finally"],
          } as TryCatchActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("Finally actions"))).toBe(
        true
      );
    });

    it("should handle TRY_CATCH without catch", () => {
      const actions: Action[] = [
        {
          id: "try-1",
          type: "TRY_CATCH",
          config: {
            tryActions: ["action-try"],
          } as TryCatchActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      const connections = result.workflow.connections["try-1"];
      expect(connections.success).toBeDefined();
      expect(connections.error).toBeUndefined();
    });
  });

  describe("Complex Workflows", () => {
    it("should handle workflow with multiple control flow types", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: {
              type: "expression",
              expression: "x > 5",
            },
            thenActions: ["action-then"],
          } as IfActionConfig,
          position: [0, 0],
        },
        {
          id: "loop-1",
          type: "LOOP",
          config: {
            loopType: "FOR",
            iterations: 3,
            actions: ["action-loop-body"],
          } as LoopActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      expect(result.stats.actionsConverted).toBe(4);
      expect(result.stats.controlFlowExpanded).toBe(2);
      expect(result.workflow.actions).toHaveLength(4);
    });

    it("should handle linear workflow with control flow at end", () => {
      const actions: Action[] = [
        {
          id: "action-1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "action-2",
          type: "TYPE",
          config: {} as TypeActionConfig,
          position: [0, 0],
        },
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: {
              type: "expression",
              expression: "success",
            },
            thenActions: ["action-success"],
            elseActions: ["action-failure"],
          } as IfActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);

      // Check linear connections
      expect(result.workflow.connections["action-1"].main?.[0][0].action).toBe(
        "action-2"
      );

      // IF action should not have linear connection to next (it's the last action)
      expect(result.workflow.connections["if-1"].main).toHaveLength(2); // then and else
    });
  });

  describe("extractNestedActions", () => {
    it("should extract actions from IF config", () => {
      const action: Action<"IF"> = {
        id: "if-1",
        type: "IF",
        config: {
          condition: { type: "expression", expression: "true" },
          thenActions: ["action-1", "action-2"],
          elseActions: ["action-3"],
        },
        position: [0, 0],
      };

      const extracted = converter.extractNestedActions(action);
      expect(extracted).toEqual(["action-1", "action-2", "action-3"]);
    });

    it("should extract actions from LOOP config", () => {
      const action: Action<"LOOP"> = {
        id: "loop-1",
        type: "LOOP",
        config: {
          loopType: "FOR",
          iterations: 5,
          actions: ["action-1", "action-2"],
        },
        position: [0, 0],
      };

      const extracted = converter.extractNestedActions(action);
      expect(extracted).toEqual(["action-1", "action-2"]);
    });

    it("should extract actions from SWITCH config", () => {
      const action: Action<"SWITCH"> = {
        id: "switch-1",
        type: "SWITCH",
        config: {
          expression: "x",
          cases: [
            { value: 1, actions: ["action-1"] },
            { value: 2, actions: ["action-2"] },
          ],
          defaultActions: ["action-default"],
        },
        position: [0, 0],
      };

      const extracted = converter.extractNestedActions(action);
      expect(extracted).toEqual(["action-1", "action-2", "action-default"]);
    });

    it("should extract actions from TRY_CATCH config", () => {
      const action: Action<"TRY_CATCH"> = {
        id: "try-1",
        type: "TRY_CATCH",
        config: {
          tryActions: ["action-1"],
          catchActions: ["action-2"],
          finallyActions: ["action-3"],
        },
        position: [0, 0],
      };

      const extracted = converter.extractNestedActions(action);
      expect(extracted).toEqual(["action-1", "action-2", "action-3"]);
    });

    it("should return empty array for non-control-flow actions", () => {
      const action: Action<"CLICK"> = {
        id: "click-1",
        type: "CLICK",
        config: {} as ClickActionConfig,
        position: [0, 0],
      };

      const extracted = converter.extractNestedActions(action);
      expect(extracted).toEqual([]);
    });
  });

  describe("Conversion Statistics", () => {
    it("should track actions converted", () => {
      const actions: Action[] = [
        {
          id: "1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.stats.actionsConverted).toBe(3);
    });

    it("should track connections created", () => {
      const actions: Action[] = [
        {
          id: "1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.stats.connectionsCreated).toBe(2); // 1->2, 2->3
    });

    it("should track control flow expanded", () => {
      const actions: Action[] = [
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: { type: "expression", expression: "x" },
            thenActions: ["a1"],
          } as IfActionConfig,
          position: [0, 0],
        },
        {
          id: "loop-1",
          type: "LOOP",
          config: {
            loopType: "FOR",
            iterations: 5,
            actions: ["a2"],
          } as LoopActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.stats.controlFlowExpanded).toBe(2);
    });

    it("should track max depth", () => {
      const actions: Action[] = [
        {
          id: "1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "3",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.stats.maxDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Workflow Metadata", () => {
    it("should include workflow metadata", () => {
      const result = converter.convert([]);

      expect(result.workflow.id).toBe("test-workflow-1");
      expect(result.workflow.name).toBe("Test Workflow");
      expect(result.workflow.version).toBeDefined();
      expect(result.workflow.format).toBe("graph");
      expect(result.workflow.metadata?.created).toBeDefined();
      expect(result.workflow.metadata?.description).toContain("Converted");
    });

    it("should use custom workflow options", () => {
      const converter = new SequentialToGraphConverter({
        workflowName: "Custom Name",
        workflowId: "custom-id",
        version: "2.0.0",
      });

      const result = converter.convert([]);

      expect(result.workflow.name).toBe("Custom Name");
      expect(result.workflow.id).toBe("custom-id");
      expect(result.workflow.version).toBe("2.0.0");
    });
  });

  describe("Edge Cases", () => {
    it("should handle actions with no config", () => {
      const actions: Action[] = [
        {
          id: "break-1",
          type: "BREAK",
          config: {},
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.workflow.actions).toHaveLength(1);
    });

    it("should handle control flow with empty action lists", () => {
      const actions: Action[] = [
        {
          id: "if-1",
          type: "IF",
          config: {
            condition: { type: "expression", expression: "x" },
            thenActions: [],
          } as IfActionConfig,
          position: [0, 0],
        },
      ];

      const result = converter.convert(actions);
      expect(result.workflow.actions).toHaveLength(1);
    });

    it("should throw error for invalid input", () => {
      expect(() => {
        converter.convert(null as unknown);
      }).toThrow("Actions must be an array");

      expect(() => {
        converter.convert(undefined as unknown);
      }).toThrow("Actions must be an array");

      expect(() => {
        converter.convert("not an array" as unknown);
      }).toThrow("Actions must be an array");
    });
  });

  describe("Convenience Function", () => {
    it("should work with convertSequentialToGraph function", () => {
      const actions: Action[] = [
        {
          id: "1",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
        {
          id: "2",
          type: "CLICK",
          config: {} as ClickActionConfig,
          position: [0, 0],
        },
      ];

      const workflow = convertSequentialToGraph(actions, {
        workflowName: "Quick Convert",
      });

      expect(workflow.name).toBe("Quick Convert");
      expect(workflow.actions).toHaveLength(2);
      expect(workflow.format).toBe("graph");
    });
  });
});
