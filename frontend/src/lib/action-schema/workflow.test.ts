/**
 * Tests for the graph-format workflow schema
 *
 * action-schema is graph-only (see index.ts comment "Graph Format Only").
 * These tests cover the currently-exported API surface:
 *   - Action helpers (getActionOutputCount, getActionInputCount, createAction)
 *   - Workflow utilities (getEntryPoints, getNextActions, hasCycles, ...)
 *   - Validation (validateWorkflow → { valid, errors }, isWorkflowValid,
 *     getValidationSummary)
 *   - Complex action shapes (IF, TRY_CATCH, SWITCH, parallel)
 *
 * Removed from prior revisions of this file:
 *   - Sequential format detection (detectWorkflowFormat, isGraphWorkflow,
 *     isSequentialWorkflow) — the schema is graph-only.
 *   - Separate validateConnections/validatePositions/validateNoOrphans exports
 *     — those are private helpers inside validateWorkflow now.
 *   - Warning-based assertions — validation returns errors only.
 */

import { describe, expect, test } from "vitest";
import {
  Workflow,
  createAction,
  getActionOutputCount,
  getActionInputCount,
  getEntryPoints,
  getActionConnections,
  getNextActions,
  getPreviousActions,
  hasCycles,
  hasMergeNodes,
  findOrphanedActions,
  getActionById,
  getActionsByType,
  calculateActionDepths,
  getTopologicalOrder,
  cloneWorkflow,
  validateWorkflow,
  isWorkflowValid,
  getValidationSummary,
} from "./index";

// ============================================================================
// Fixture helpers
// ============================================================================

const click = (id: string, pos: [number, number] = [0, 0]) =>
  createAction("CLICK", { target: { image: "test.png" } }, pos, { id });

const type_ = (id: string, pos: [number, number] = [0, 0]) =>
  createAction("TYPE", { text: "hello" }, pos, { id });

const find_ = (id: string, pos: [number, number] = [0, 0]) =>
  createAction(
    "FIND",
    { target: { image: "result.png" }, strategy: "FIRST" },
    pos,
    { id }
  );

const baseWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
  id: "wf-1",
  name: "Test",
  version: "1.0.0",
  format: "graph",
  actions: [],
  connections: {},
  ...overrides,
});

// ============================================================================
// Action helpers
// ============================================================================

describe("Action Output Count", () => {
  test("standard actions have 1 output", () => {
    expect(getActionOutputCount("CLICK")).toBe(1);
    expect(getActionOutputCount("TYPE")).toBe(1);
    expect(getActionOutputCount("FIND")).toBe(1);
  });

  test("IF has 2 outputs (true/false branches)", () => {
    expect(getActionOutputCount("IF")).toBe(2);
  });

  test("TRY_CATCH has 2 outputs (success/error)", () => {
    expect(getActionOutputCount("TRY_CATCH")).toBe(2);
  });

  test("SWITCH outputs = cases.length + 1 (default)", () => {
    const config = {
      variable: "status",
      cases: [
        { value: "success", actions: [] },
        { value: "error", actions: [] },
      ],
      default: [],
    };
    expect(getActionOutputCount("SWITCH", config)).toBe(3);
  });
});

describe("Action Input Count", () => {
  test("all actions have exactly 1 input", () => {
    expect(getActionInputCount()).toBe(1);
  });
});

// ============================================================================
// Workflow utilities
// ============================================================================

describe("Entry Points", () => {
  test("actions with no incoming connections are entry points", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1"), type_("action-2"), find_("action-3")],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      },
    });
    // action-1 and action-3 have no incoming connections
    expect(getEntryPoints(workflow).sort()).toEqual(["action-1", "action-3"]);
  });

  test("empty workflow has no entry points", () => {
    expect(getEntryPoints(baseWorkflow())).toEqual([]);
  });
});

describe("Navigation", () => {
  const workflow = baseWorkflow({
    actions: [click("action-1"), type_("action-2"), find_("action-3")],
    connections: {
      "action-1": {
        main: [[{ action: "action-2", type: "main", index: 0 }]],
      },
      "action-2": {
        main: [[{ action: "action-3", type: "main", index: 0 }]],
      },
    },
  });

  test("getNextActions follows main outputs", () => {
    expect(getNextActions(workflow, "action-1")).toEqual(["action-2"]);
    expect(getNextActions(workflow, "action-2")).toEqual(["action-3"]);
    expect(getNextActions(workflow, "action-3")).toEqual([]);
  });

  test("getPreviousActions walks backward", () => {
    expect(getPreviousActions(workflow, "action-1")).toEqual([]);
    expect(getPreviousActions(workflow, "action-2")).toEqual(["action-1"]);
    expect(getPreviousActions(workflow, "action-3")).toEqual(["action-2"]);
  });

  test("getActionById returns the action by id", () => {
    const action = getActionById(workflow, "action-2");
    expect(action?.id).toBe("action-2");
    expect(action?.type).toBe("TYPE");
  });

  test("getActionsByType filters by action type", () => {
    const clicks = getActionsByType(workflow, "CLICK");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].id).toBe("action-1");
  });

  test("getActionConnections returns the action's outputs", () => {
    expect(getActionConnections(workflow, "action-1")).toBeDefined();
    expect(getActionConnections(workflow, "action-3")).toBeUndefined();
  });
});

describe("Graph Analysis", () => {
  test("hasCycles detects a cycle reachable from an entry point", () => {
    // hasCycles walks forward from entry points, so the cycle must be
    // reachable from one. Pure cycles (with no entry) are a separate case
    // this function does not currently detect.
    const cyclic = baseWorkflow({
      actions: [click("entry"), type_("a"), find_("b")],
      connections: {
        entry: {
          main: [[{ action: "a", type: "main", index: 0 }]],
        },
        a: {
          main: [[{ action: "b", type: "main", index: 0 }]],
        },
        b: {
          main: [[{ action: "a", type: "main", index: 0 }]],
        },
      },
    });
    expect(hasCycles(cyclic)).toBe(true);
  });

  test("hasCycles returns false for an acyclic graph", () => {
    const acyclic = baseWorkflow({
      actions: [click("action-1"), type_("action-2")],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      },
    });
    expect(hasCycles(acyclic)).toBe(false);
  });

  test("hasMergeNodes detects actions with >1 incoming connection", () => {
    const merging = baseWorkflow({
      actions: [click("action-1"), type_("action-2"), find_("action-3")],
      connections: {
        "action-1": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
        "action-2": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
      },
    });
    expect(hasMergeNodes(merging)).toBe(true);
  });

  test("findOrphanedActions returns actions with no connections in or out", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1"), type_("action-2"), find_("action-orphan")],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      },
    });
    expect(findOrphanedActions(workflow)).toEqual(["action-orphan"]);
  });

  test("calculateActionDepths measures distance from entry points", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1"), type_("action-2"), find_("action-3")],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
        "action-2": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
      },
    });
    const depths = calculateActionDepths(workflow);
    expect(depths.get("action-1")).toBe(0);
    expect(depths.get("action-2")).toBe(1);
    expect(depths.get("action-3")).toBe(2);
  });

  test("getTopologicalOrder respects predecessor ordering", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1"), type_("action-2"), find_("action-3")],
      connections: {
        "action-1": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
        "action-2": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
      },
    });
    const order = getTopologicalOrder(workflow);
    expect(order).not.toBeNull();
    if (order) {
      expect(order.indexOf("action-1")).toBeLessThan(order.indexOf("action-3"));
      expect(order.indexOf("action-2")).toBeLessThan(order.indexOf("action-3"));
    }
  });

  test("getTopologicalOrder returns null for a cycle reachable from an entry point", () => {
    // Same caveat as hasCycles: the cycle must be reachable from an entry.
    const cyclic = baseWorkflow({
      actions: [click("entry"), type_("a"), find_("b")],
      connections: {
        entry: {
          main: [[{ action: "a", type: "main", index: 0 }]],
        },
        a: {
          main: [[{ action: "b", type: "main", index: 0 }]],
        },
        b: {
          main: [[{ action: "a", type: "main", index: 0 }]],
        },
      },
    });
    expect(getTopologicalOrder(cyclic)).toBeNull();
  });
});

describe("Workflow Cloning", () => {
  test("cloneWorkflow assigns a new workflow id and new action ids, keeping connections consistent", () => {
    const original = baseWorkflow({
      actions: [click("action-1"), type_("action-2")],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      },
    });

    const cloned = cloneWorkflow(original, "wf-clone");

    expect(cloned.id).toBe("wf-clone");
    expect(cloned.actions[0].id).not.toBe("action-1");
    expect(cloned.actions[1].id).not.toBe("action-2");

    const first = cloned.actions[0].id;
    const second = cloned.actions[1].id;
    expect(cloned.connections[first]).toBeDefined();
    expect(cloned.connections[first].main?.[0][0].action).toBe(second);

    expect(cloned.name).toBe(original.name);
    expect(cloned.format).toBe("graph");
  });
});

// ============================================================================
// Validation
// ============================================================================

describe("Validation — basic", () => {
  test("a connected graph workflow is valid", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1", [0, 0]), type_("action-2", [100, 0])],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
      },
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(isWorkflowValid(workflow)).toBe(true);
  });

  test("missing id/name/version produce errors", () => {
    const result = validateWorkflow({
      actions: [],
    } as unknown as Workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("duplicate action ids produce a duplicate_action_id error", () => {
    const workflow = baseWorkflow({
      actions: [click("duplicate", [0, 0]), type_("duplicate", [100, 0])],
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "duplicate_action_id")).toBe(
      true
    );
  });
});

describe("Validation — connections", () => {
  test("a connection target that does not exist is a missing_action error", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1", [0, 0])],
      connections: {
        "action-1": {
          main: [[{ action: "nonexistent", type: "main", index: 0 }]],
        },
      },
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "missing_action")).toBe(true);
  });

  test("using more output slots than the action has is invalid_output_index", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1", [0, 0]), type_("action-2", [100, 0])],
      // CLICK has 1 output but two output slots are used here.
      connections: {
        "action-1": {
          main: [
            [{ action: "action-2", type: "main", index: 0 }],
            [{ action: "action-2", type: "main", index: 0 }],
          ],
        },
      },
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_output_index")).toBe(
      true
    );
  });

  test("a cycle reachable from an entry point produces a cycle_detected error", () => {
    const workflow = baseWorkflow({
      actions: [
        click("entry", [0, 0]),
        type_("a", [100, 0]),
        find_("b", [200, 0]),
      ],
      connections: {
        entry: {
          main: [[{ action: "a", type: "main", index: 0 }]],
        },
        a: {
          main: [[{ action: "b", type: "main", index: 0 }]],
        },
        b: {
          main: [[{ action: "a", type: "main", index: 0 }]],
        },
      },
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "cycle_detected")).toBe(true);
  });
});

describe("Validation — positions", () => {
  test("missing position is an invalid_position error", () => {
    const action = click("action-1");
    // Directly strip the position to simulate a pre-validation action.
    (action as { position?: unknown }).position = undefined;
    const workflow = baseWorkflow({
      actions: [action],
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_position")).toBe(true);
  });

  test("a malformed position array is an invalid_position error", () => {
    const action = click("action-1");
    (action as { position: unknown }).position = [100];
    const workflow = baseWorkflow({
      actions: [action],
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_position")).toBe(true);
  });
});

describe("Validation — orphans", () => {
  test("orphaned actions produce an orphaned_action error", () => {
    const workflow = baseWorkflow({
      actions: [click("action-1", [0, 0]), type_("action-orphan", [100, 0])],
      connections: {},
    });
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === "orphaned_action")).toBe(true);
  });
});

describe("Validation — summary", () => {
  test("getValidationSummary produces a readable string", () => {
    const workflow = baseWorkflow({
      actions: [],
    });
    const result = validateWorkflow(workflow);
    const summary = getValidationSummary(result);
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Complex action scenarios
// ============================================================================

describe("Complex Graph Scenarios", () => {
  test("IF exposes both branches via getNextActions", () => {
    const workflow = baseWorkflow({
      actions: [
        createAction(
          "IF",
          { condition: "x > 0", thenActions: [], elseActions: [] },
          [0, 0],
          { id: "if-1" }
        ),
        click("then-action", [100, -50]),
        type_("else-action", [100, 50]),
      ],
      connections: {
        "if-1": {
          main: [
            [{ action: "then-action", type: "main", index: 0 }],
            [{ action: "else-action", type: "main", index: 0 }],
          ],
        },
      },
    });

    expect(getActionOutputCount("IF")).toBe(2);
    expect(getNextActions(workflow, "if-1")).toEqual([
      "then-action",
      "else-action",
    ]);
    expect(isWorkflowValid(workflow)).toBe(true);
  });

  test("parallel connection type exposes all downstream actions", () => {
    const workflow = baseWorkflow({
      actions: [
        createAction("CLICK", { target: { image: "start.png" } }, [0, 0], {
          id: "start",
        }),
        type_("parallel-a", [100, -50]),
        type_("parallel-b", [100, 50]),
      ],
      connections: {
        start: {
          parallel: [
            [
              { action: "parallel-a", type: "main", index: 0 },
              { action: "parallel-b", type: "main", index: 0 },
            ],
          ],
        },
      },
    });

    expect(getNextActions(workflow, "start", "parallel")).toEqual([
      "parallel-a",
      "parallel-b",
    ]);
    expect(isWorkflowValid(workflow)).toBe(true);
  });

  test("TRY_CATCH routes success and error via separate connection types", () => {
    const workflow = baseWorkflow({
      actions: [
        createAction(
          "TRY_CATCH",
          { tryActions: [], catchActions: [] },
          [0, 0],
          { id: "try-1" }
        ),
        createAction(
          "CLICK",
          { target: { image: "success.png" } },
          [100, -50],
          { id: "success" }
        ),
        createAction("CLICK", { target: { image: "error.png" } }, [100, 50], {
          id: "error",
        }),
      ],
      connections: {
        "try-1": {
          success: [[{ action: "success", type: "main", index: 0 }]],
          error: [[{ action: "error", type: "main", index: 0 }]],
        },
      },
    });

    expect(getActionOutputCount("TRY_CATCH")).toBe(2);
    expect(getNextActions(workflow, "try-1", "success")).toEqual(["success"]);
    expect(getNextActions(workflow, "try-1", "error")).toEqual(["error"]);
    expect(isWorkflowValid(workflow)).toBe(true);
  });
});
