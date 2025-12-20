/**
 * Node Component Tests
 *
 * Tests for all custom node components to ensure they render correctly
 * with various configurations and states.
 */

import { describe, it, expect } from "@jest/globals";
import { Action } from "@/lib/action-schema/action-types";
import {
  getNodeSummary,
  getNodeCategory,
  getOutputCount,
  getOutputHandleIds,
  validateNodeConfig,
  isTerminalNode,
  isBranchingNode,
} from "./node-utils";

describe("Node Utilities", () => {
  describe("getNodeCategory", () => {
    it("returns correct category for find actions", () => {
      expect(getNodeCategory("FIND")).toBe("find");
      expect(getNodeCategory("VANISH")).toBe("find");
    });

    it("returns correct category for mouse actions", () => {
      expect(getNodeCategory("CLICK")).toBe("mouse");
      expect(getNodeCategory("DOUBLE_CLICK")).toBe("mouse");
      expect(getNodeCategory("DRAG")).toBe("mouse");
    });

    it("returns correct category for keyboard actions", () => {
      expect(getNodeCategory("TYPE")).toBe("keyboard");
      expect(getNodeCategory("KEY_PRESS")).toBe("keyboard");
      expect(getNodeCategory("HOTKEY")).toBe("keyboard");
    });

    it("returns correct category for control flow actions", () => {
      expect(getNodeCategory("IF")).toBe("controlFlow");
      expect(getNodeCategory("LOOP")).toBe("controlFlow");
      expect(getNodeCategory("SWITCH")).toBe("controlFlow");
    });

    it("returns correct category for data actions", () => {
      expect(getNodeCategory("SET_VARIABLE")).toBe("data");
      expect(getNodeCategory("FILTER")).toBe("data");
      expect(getNodeCategory("SORT")).toBe("data");
    });
  });

  describe("getNodeSummary", () => {
    it("generates summary for CLICK action", () => {
      const action: Action<"CLICK"> = {
        id: "1",
        type: "CLICK",
        config: {
          target: { text: "Submit Button" },
        },
        position: [0, 0],
      };

      const summary = getNodeSummary(action);
      expect(summary).toBe('Click "Submit Button"');
    });

    it("generates summary for TYPE action", () => {
      const action: Action<"TYPE"> = {
        id: "2",
        type: "TYPE",
        config: {
          text: "Hello World",
        },
        position: [0, 0],
      };

      const summary = getNodeSummary(action);
      expect(summary).toBe('Type "Hello World"');
    });

    it("generates summary for VANISH action", () => {
      const action: Action<"VANISH"> = {
        id: "3",
        type: "VANISH",
        config: {
          target: { text: "Loading..." },
          timeout: 2000,
        },
        position: [0, 0],
      };

      const summary = getNodeSummary(action);
      expect(summary).toContain("Vanish");
    });

    it("generates summary for IF action", () => {
      const action: Action<"IF"> = {
        id: "4",
        type: "IF",
        config: {
          condition: { type: "expression", expression: "x > 10" },
          thenActions: [],
        },
        position: [0, 0],
      };

      const summary = getNodeSummary(action);
      expect(summary).toBe("If (expression)");
    });

    it("generates summary for LOOP action", () => {
      const action: Action<"LOOP"> = {
        id: "5",
        type: "LOOP",
        config: {
          loopType: "FOR",
          iterations: 5,
          actions: [],
        },
        position: [0, 0],
      };

      const summary = getNodeSummary(action);
      expect(summary).toBe("Loop 5 times");
    });
  });

  describe("getOutputCount", () => {
    it("returns 1 for standard actions", () => {
      const action: Action<"CLICK"> = {
        id: "1",
        type: "CLICK",
        config: { target: {} },
        position: [0, 0],
      };

      expect(getOutputCount(action)).toBe(1);
    });

    it("returns 2 for IF actions", () => {
      const action: Action<"IF"> = {
        id: "2",
        type: "IF",
        config: {
          condition: { type: "expression" },
          thenActions: [],
        },
        position: [0, 0],
      };

      expect(getOutputCount(action)).toBe(2);
    });

    it("returns 2 for LOOP actions", () => {
      const action: Action<"LOOP"> = {
        id: "3",
        type: "LOOP",
        config: {
          loopType: "FOR",
          iterations: 5,
          actions: [],
        },
        position: [0, 0],
      };

      expect(getOutputCount(action)).toBe(2);
    });

    it("returns 2 for TRY_CATCH actions", () => {
      const action: Action<"TRY_CATCH"> = {
        id: "4",
        type: "TRY_CATCH",
        config: {
          tryActions: [],
        },
        position: [0, 0],
      };

      expect(getOutputCount(action)).toBe(2);
    });

    it("returns N+1 for SWITCH actions", () => {
      const action: Action<"SWITCH"> = {
        id: "5",
        type: "SWITCH",
        config: {
          expression: "value",
          cases: [
            { value: 1, actions: [] },
            { value: 2, actions: [] },
            { value: 3, actions: [] },
          ],
        },
        position: [0, 0],
      };

      expect(getOutputCount(action)).toBe(4); // 3 cases + 1 default
    });
  });

  describe("getOutputHandleIds", () => {
    it("returns main for standard actions", () => {
      const action: Action<"CLICK"> = {
        id: "1",
        type: "CLICK",
        config: { target: {} },
        position: [0, 0],
      };

      expect(getOutputHandleIds(action)).toEqual(["main"]);
    });

    it("returns true/false for IF actions", () => {
      const action: Action<"IF"> = {
        id: "2",
        type: "IF",
        config: {
          condition: { type: "expression" },
          thenActions: [],
        },
        position: [0, 0],
      };

      expect(getOutputHandleIds(action)).toEqual(["true", "false"]);
    });

    it("returns loop/main for LOOP actions", () => {
      const action: Action<"LOOP"> = {
        id: "3",
        type: "LOOP",
        config: {
          loopType: "FOR",
          iterations: 5,
          actions: [],
        },
        position: [0, 0],
      };

      expect(getOutputHandleIds(action)).toEqual(["loop", "main"]);
    });

    it("returns main/error for TRY_CATCH actions", () => {
      const action: Action<"TRY_CATCH"> = {
        id: "4",
        type: "TRY_CATCH",
        config: {
          tryActions: [],
        },
        position: [0, 0],
      };

      expect(getOutputHandleIds(action)).toEqual(["main", "error"]);
    });

    it("returns empty array for terminal nodes", () => {
      const breakAction: Action<"BREAK"> = {
        id: "5",
        type: "BREAK",
        config: {},
        position: [0, 0],
      };

      expect(getOutputHandleIds(breakAction)).toEqual([]);

      const continueAction: Action<"CONTINUE"> = {
        id: "6",
        type: "CONTINUE",
        config: {},
        position: [0, 0],
      };

      expect(getOutputHandleIds(continueAction)).toEqual([]);
    });
  });

  describe("validateNodeConfig", () => {
    it("validates CLICK action config", () => {
      const validAction: Action<"CLICK"> = {
        id: "1",
        type: "CLICK",
        config: {
          target: { text: "Button" },
        },
        position: [0, 0],
      };

      const validation = validateNodeConfig(validAction);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("allows CLICK action without target (clicks at current position)", () => {
      const validAction: Action<"CLICK"> = {
        id: "2",
        type: "CLICK",
        config: {} as unknown, // No target = clicks at current position (pure action)
        position: [0, 0],
      };

      const validation = validateNodeConfig(validAction);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("validates IF action config", () => {
      const validAction: Action<"IF"> = {
        id: "3",
        type: "IF",
        config: {
          condition: { type: "expression", expression: "x > 10" },
          thenActions: ["action-1"],
        },
        position: [0, 0],
      };

      const validation = validateNodeConfig(validAction);
      expect(validation.valid).toBe(true);
    });

    it("detects missing IF condition", () => {
      const invalidAction: Action<"IF"> = {
        id: "4",
        type: "IF",
        config: {
          thenActions: ["action-1"],
        } as unknown,
        position: [0, 0],
      };

      const validation = validateNodeConfig(invalidAction);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing IF condition");
    });

    it("validates LOOP action config", () => {
      const validAction: Action<"LOOP"> = {
        id: "5",
        type: "LOOP",
        config: {
          loopType: "FOR",
          iterations: 10,
          actions: ["action-1"],
        },
        position: [0, 0],
      };

      const validation = validateNodeConfig(validAction);
      expect(validation.valid).toBe(true);
    });

    it("detects missing LOOP iterations", () => {
      const invalidAction: Action<"LOOP"> = {
        id: "6",
        type: "LOOP",
        config: {
          loopType: "FOR",
          actions: ["action-1"],
        } as unknown,
        position: [0, 0],
      };

      const validation = validateNodeConfig(invalidAction);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("FOR loop missing iterations count");
    });
  });

  describe("isTerminalNode", () => {
    it("returns true for BREAK", () => {
      expect(isTerminalNode("BREAK")).toBe(true);
    });

    it("returns true for CONTINUE", () => {
      expect(isTerminalNode("CONTINUE")).toBe(true);
    });

    it("returns false for other actions", () => {
      expect(isTerminalNode("CLICK")).toBe(false);
      expect(isTerminalNode("IF")).toBe(false);
      expect(isTerminalNode("LOOP")).toBe(false);
    });
  });

  describe("isBranchingNode", () => {
    it("returns true for IF", () => {
      expect(isBranchingNode("IF")).toBe(true);
    });

    it("returns true for LOOP", () => {
      expect(isBranchingNode("LOOP")).toBe(true);
    });

    it("returns true for SWITCH", () => {
      expect(isBranchingNode("SWITCH")).toBe(true);
    });

    it("returns true for TRY_CATCH", () => {
      expect(isBranchingNode("TRY_CATCH")).toBe(true);
    });

    it("returns false for other actions", () => {
      expect(isBranchingNode("CLICK")).toBe(false);
      expect(isBranchingNode("TYPE")).toBe(false);
      expect(isBranchingNode("SET_VARIABLE")).toBe(false);
    });
  });
});

describe("Node Registry", () => {
  it("exports all 30+ action types", () => {
    const { NODE_TYPES } = require("./node-registry");
    const registeredTypes = Object.keys(NODE_TYPES);

    // Should have all action types registered
    expect(registeredTypes.length).toBeGreaterThanOrEqual(30);

    // Check key action types
    expect(registeredTypes).toContain("CLICK");
    expect(registeredTypes).toContain("TYPE");
    expect(registeredTypes).toContain("IF");
    expect(registeredTypes).toContain("LOOP");
    expect(registeredTypes).toContain("SET_VARIABLE");
  });
});
