/**
 * Comprehensive tests for workflow graph format support
 *
 * Tests workflow types, utilities, validation, and backward compatibility
 */

import {
  Workflow,
  createAction,
  detectWorkflowFormat,
  isGraphWorkflow,
  isSequentialWorkflow,
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
  validateConnections,
  validatePositions,
  validateNoOrphans,
  isWorkflowValid,
  getValidationSummary,
} from "./index";

describe("Workflow Type System", () => {
  describe("Format Detection", () => {
    test("should detect sequential format by default", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [],
      };
      expect(detectWorkflowFormat(workflow)).toBe("sequential");
      expect(isSequentialWorkflow(workflow)).toBe(true);
      expect(isGraphWorkflow(workflow)).toBe(false);
    });

    test("should detect explicit sequential format", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "sequential",
        actions: [],
      };
      expect(detectWorkflowFormat(workflow)).toBe("sequential");
    });

    test("should detect explicit graph format", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [],
        connections: {},
      };
      expect(detectWorkflowFormat(workflow)).toBe("graph");
      expect(isGraphWorkflow(workflow)).toBe(true);
    });

    test("should detect graph format from connections", () => {
      const workflow: unknown = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
        },
      };
      expect(detectWorkflowFormat(workflow)).toBe("graph");
    });

    test("should detect graph format from action positions", () => {
      const action = createAction("CLICK", { target: { image: "test.png" } });
      action.position = [100, 200];
      const workflow: unknown = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [action],
      };
      expect(detectWorkflowFormat(workflow)).toBe("graph");
    });
  });

  describe("Action Output Count", () => {
    test("should return 1 for standard actions", () => {
      expect(getActionOutputCount("CLICK")).toBe(1);
      expect(getActionOutputCount("TYPE")).toBe(1);
      expect(getActionOutputCount("FIND")).toBe(1);
    });

    test("should return 2 for IF action", () => {
      expect(getActionOutputCount("IF")).toBe(2);
    });

    test("should return 2 for TRY_CATCH action", () => {
      expect(getActionOutputCount("TRY_CATCH")).toBe(2);
    });

    test("should return correct count for SWITCH action", () => {
      const config = {
        variable: "status",
        cases: [
          { value: "success", actions: [] },
          { value: "error", actions: [] },
        ],
        default: [],
      };
      expect(getActionOutputCount("SWITCH", config)).toBe(3); // 2 cases + 1 default
    });
  });

  describe("Action Input Count", () => {
    test("should return 1 for all actions", () => {
      expect(getActionInputCount("CLICK")).toBe(1);
      expect(getActionInputCount("IF")).toBe(1);
      expect(getActionInputCount("SWITCH")).toBe(1);
    });
  });
});

describe("Workflow Utilities", () => {
  describe("Entry Points", () => {
    test("should return first action for sequential workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
      };
      expect(getEntryPoints(workflow)).toEqual(["action-1"]);
    });

    test("should return empty array for empty workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [],
      };
      expect(getEntryPoints(workflow)).toEqual([]);
    });

    test("should return actions with no incoming connections for graph workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
          createAction(
            "FIND",
            { target: { image: "result.png" }, strategy: "FIRST" },
            { id: "action-3" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
        },
      };
      // action-1 and action-3 have no incoming connections
      expect(getEntryPoints(workflow).sort()).toEqual(
        ["action-1", "action-3"].sort()
      );
    });
  });

  describe("Navigation", () => {
    const workflow: Workflow = {
      id: "wf-1",
      name: "Test",
      version: "1.0.0",
      format: "graph",
      actions: [
        createAction(
          "CLICK",
          { target: { image: "test.png" } },
          { id: "action-1" }
        ),
        createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        createAction(
          "FIND",
          { target: { image: "result.png" }, strategy: "FIRST" },
          { id: "action-3" }
        ),
      ],
      connections: {
        "action-1": {
          main: [[{ action: "action-2", type: "main", index: 0 }]],
        },
        "action-2": {
          main: [[{ action: "action-3", type: "main", index: 0 }]],
        },
      },
    };

    test("should get next actions", () => {
      expect(getNextActions(workflow, "action-1")).toEqual(["action-2"]);
      expect(getNextActions(workflow, "action-2")).toEqual(["action-3"]);
      expect(getNextActions(workflow, "action-3")).toEqual([]);
    });

    test("should get previous actions", () => {
      expect(getPreviousActions(workflow, "action-1")).toEqual([]);
      expect(getPreviousActions(workflow, "action-2")).toEqual(["action-1"]);
      expect(getPreviousActions(workflow, "action-3")).toEqual(["action-2"]);
    });

    test("should get action by ID", () => {
      const action = getActionById(workflow, "action-2");
      expect(action?.id).toBe("action-2");
      expect(action?.type).toBe("TYPE");
    });

    test("should get actions by type", () => {
      const clickActions = getActionsByType(workflow, "CLICK");
      expect(clickActions).toHaveLength(1);
      expect(clickActions[0].id).toBe("action-1");
    });
  });

  describe("Graph Analysis", () => {
    test("should detect cycles", () => {
      const workflowWithCycle: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
          "action-2": {
            main: [[{ action: "action-1", type: "main", index: 0 }]], // Cycle!
          },
        },
      };
      expect(hasCycles(workflowWithCycle)).toBe(true);
    });

    test("should not detect cycles in acyclic graph", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
        },
      };
      expect(hasCycles(workflow)).toBe(false);
    });

    test("should detect merge nodes", () => {
      const workflowWithMerge: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
          createAction(
            "FIND",
            { target: { image: "result.png" }, strategy: "FIRST" },
            { id: "action-3" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-3", type: "main", index: 0 }]],
          },
          "action-2": {
            main: [[{ action: "action-3", type: "main", index: 0 }]], // Merge!
          },
        },
      };
      expect(hasMergeNodes(workflowWithMerge)).toBe(true);
    });

    test("should find orphaned actions", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
          createAction(
            "FIND",
            { target: { image: "result.png" }, strategy: "FIRST" },
            { id: "action-orphan" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
        },
      };
      expect(findOrphanedActions(workflow)).toEqual(["action-orphan"]);
    });

    test("should calculate action depths", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
          createAction(
            "FIND",
            { target: { image: "result.png" }, strategy: "FIRST" },
            { id: "action-3" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
          "action-2": {
            main: [[{ action: "action-3", type: "main", index: 0 }]],
          },
        },
      };
      const depths = calculateActionDepths(workflow);
      expect(depths.get("action-1")).toBe(0);
      expect(depths.get("action-2")).toBe(1);
      expect(depths.get("action-3")).toBe(2);
    });

    test("should get topological order", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
          createAction(
            "FIND",
            { target: { image: "result.png" }, strategy: "FIRST" },
            { id: "action-3" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-3", type: "main", index: 0 }]],
          },
          "action-2": {
            main: [[{ action: "action-3", type: "main", index: 0 }]],
          },
        },
      };
      const order = getTopologicalOrder(workflow);
      expect(order).not.toBeNull();
      if (order) {
        expect(order.indexOf("action-1")).toBeLessThan(
          order.indexOf("action-3")
        );
        expect(order.indexOf("action-2")).toBeLessThan(
          order.indexOf("action-3")
        );
      }
    });

    test("should return null for cyclic graph", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
          "action-2": {
            main: [[{ action: "action-1", type: "main", index: 0 }]],
          },
        },
      };
      expect(getTopologicalOrder(workflow)).toBeNull();
    });
  });

  describe("Workflow Cloning", () => {
    test("should clone workflow with new IDs", () => {
      const original: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
        },
      };

      const cloned = cloneWorkflow(original, "wf-clone");

      // Workflow ID changed
      expect(cloned.id).toBe("wf-clone");

      // Action IDs changed
      expect(cloned.actions[0].id).not.toBe("action-1");
      expect(cloned.actions[1].id).not.toBe("action-2");

      // Connections updated
      expect(cloned.connections).toBeDefined();
      const firstActionId = cloned.actions[0].id;
      const secondActionId = cloned.actions[1].id;
      expect(cloned.connections![firstActionId]).toBeDefined();
      expect(cloned.connections![firstActionId].main![0][0].action).toBe(
        secondActionId
      );

      // Other properties preserved
      expect(cloned.name).toBe(original.name);
      expect(cloned.format).toBe(original.format);
    });
  });
});

describe("Workflow Validation", () => {
  describe("Basic Validation", () => {
    test("should validate simple sequential workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
        ],
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should validate simple graph workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
        },
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(true);
      expect(isWorkflowValid(workflow)).toBe(true);
    });

    test("should require workflow id, name, version", () => {
      const workflow: unknown = {
        actions: [],
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should detect duplicate action IDs", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "duplicate" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "duplicate" }),
        ],
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "duplicate_action_id")).toBe(
        true
      );
    });
  });

  describe("Connection Validation", () => {
    test("should detect missing target action", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "nonexistent", type: "main", index: 0 }]],
          },
        },
      };
      const result = validateConnections(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "missing_action")).toBe(true);
    });

    test("should detect invalid output index", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [
              [{ action: "action-2", type: "main", index: 0 }],
              [{ action: "action-2", type: "main", index: 0 }], // Invalid: CLICK only has 1 output
            ],
          },
        },
      };
      const result = validateConnections(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "invalid_output_index")).toBe(
        true
      );
    });

    test("should detect cycles", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-2" }),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-2", type: "main", index: 0 }]],
          },
          "action-2": {
            main: [[{ action: "action-1", type: "main", index: 0 }]],
          },
        },
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "cycle_detected")).toBe(true);
    });

    test("should warn about self-connections", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-1", type: "main", index: 0 }]], // Self-connection
          },
        },
      };
      const result = validateConnections(workflow);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Position Validation", () => {
    test("should validate valid positions", () => {
      const action = createAction(
        "CLICK",
        { target: { image: "test.png" } },
        { id: "action-1" }
      );
      action.position = [100, 200];
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [action],
        connections: {},
      };
      const result = validatePositions(workflow);
      expect(result.valid).toBe(true);
    });

    test("should detect invalid position format", () => {
      const action: unknown = createAction(
        "CLICK",
        { target: { image: "test.png" } },
        { id: "action-1" }
      );
      action.position = [100]; // Invalid: should be [x, y]
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [action],
        connections: {},
      };
      const result = validatePositions(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "invalid_position")).toBe(
        true
      );
    });

    test("should warn about missing positions in graph workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
        ],
        connections: {},
      };
      const result = validatePositions(workflow);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Orphan Validation", () => {
    test("should warn about orphaned actions", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
          createAction("TYPE", { text: "hello" }, { id: "action-orphan" }),
        ],
        connections: {},
      };
      const result = validateNoOrphans(workflow);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.actionId === "action-orphan")).toBe(
        true
      );
    });
  });

  describe("Format-Specific Validation", () => {
    test("should error on connections in sequential workflow", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "sequential",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
        ],
        connections: {
          "action-1": {
            main: [[{ action: "action-1", type: "main", index: 0 }]],
          },
        },
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.type === "connections_in_sequential")
      ).toBe(true);
    });

    test("should error on graph workflow without connections", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "CLICK",
            { target: { image: "test.png" } },
            { id: "action-1" }
          ),
        ],
      };
      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.type === "missing_connections_in_graph")
      ).toBe(true);
    });
  });

  describe("Validation Summary", () => {
    test("should generate readable summary", () => {
      const workflow: Workflow = {
        id: "wf-1",
        name: "Test",
        version: "1.0.0",
        actions: [],
      };
      const result = validateWorkflow(workflow);
      const summary = getValidationSummary(result);
      expect(summary).toContain("valid");
      expect(typeof summary).toBe("string");
    });
  });
});

describe("Backward Compatibility", () => {
  test("should work with legacy sequential workflows (no format field)", () => {
    const legacyWorkflow: Workflow = {
      id: "wf-legacy",
      name: "Legacy Workflow",
      version: "1.0.0",
      actions: [
        createAction(
          "CLICK",
          { target: { image: "test.png" } },
          { id: "action-1" }
        ),
        createAction("TYPE", { text: "hello" }, { id: "action-2" }),
      ],
      // No format field, no connections, no positions
    };

    expect(detectWorkflowFormat(legacyWorkflow)).toBe("sequential");
    expect(isSequentialWorkflow(legacyWorkflow)).toBe(true);
    expect(isWorkflowValid(legacyWorkflow)).toBe(true);
    expect(getEntryPoints(legacyWorkflow)).toEqual(["action-1"]);
  });

  test("should work with actions without position field", () => {
    const action = createAction(
      "CLICK",
      { target: { image: "test.png" } },
      { id: "action-1" }
    );
    expect(action.position).toBeUndefined();
    // Action is still valid
    expect(action.id).toBe("action-1");
    expect(action.type).toBe("CLICK");
  });

  test("should handle workflows without connections", () => {
    const workflow: Workflow = {
      id: "wf-1",
      name: "Test",
      version: "1.0.0",
      actions: [
        createAction(
          "CLICK",
          { target: { image: "test.png" } },
          { id: "action-1" }
        ),
      ],
      // No connections field
    };
    expect(getActionConnections(workflow, "action-1")).toBeUndefined();
    expect(getNextActions(workflow, "action-1")).toEqual([]);
  });

  test("should handle workflows without metadata", () => {
    const workflow: Workflow = {
      id: "wf-1",
      name: "Test",
      version: "1.0.0",
      actions: [],
      // No metadata field
    };
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(true);
    // May have warning about missing metadata
    expect(result.warnings.some((w) => w.type === "missing_metadata")).toBe(
      true
    );
  });
});

describe("Complex Graph Scenarios", () => {
  test("should handle IF action with branching", () => {
    const workflow: Workflow = {
      id: "wf-1",
      name: "Branching Test",
      version: "1.0.0",
      format: "graph",
      actions: [
        createAction(
          "IF",
          {
            condition: "x > 0",
            thenActions: [],
            elseActions: [],
          },
          { id: "if-1" }
        ),
        createAction(
          "CLICK",
          { target: { image: "test.png" } },
          { id: "then-action" }
        ),
        createAction("TYPE", { text: "hello" }, { id: "else-action" }),
      ],
      connections: {
        "if-1": {
          main: [
            [{ action: "then-action", type: "main", index: 0 }], // Output 0: true branch
            [{ action: "else-action", type: "main", index: 0 }], // Output 1: false branch
          ],
        },
      },
    };

    expect(getActionOutputCount("IF")).toBe(2);
    expect(getNextActions(workflow, "if-1")).toEqual([
      "then-action",
      "else-action",
    ]);
    expect(isWorkflowValid(workflow)).toBe(true);
  });

  test("should handle parallel execution branches", () => {
    const workflow: Workflow = {
      id: "wf-1",
      name: "Parallel Test",
      version: "1.0.0",
      format: "graph",
      actions: [
        createAction(
          "CLICK",
          { target: { image: "start.png" } },
          { id: "start" }
        ),
        createAction("TYPE", { text: "A" }, { id: "parallel-a" }),
        createAction("TYPE", { text: "B" }, { id: "parallel-b" }),
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
    };

    expect(getNextActions(workflow, "start", "parallel")).toEqual([
      "parallel-a",
      "parallel-b",
    ]);
    expect(isWorkflowValid(workflow)).toBe(true);
  });

  test("should handle TRY_CATCH with error paths", () => {
    const workflow: Workflow = {
      id: "wf-1",
      name: "Error Handling",
      version: "1.0.0",
      format: "graph",
      actions: [
        createAction(
          "TRY_CATCH",
          {
            tryActions: [],
            catchActions: [],
          },
          { id: "try-1" }
        ),
        createAction(
          "CLICK",
          { target: { image: "success.png" } },
          { id: "success" }
        ),
        createAction(
          "CLICK",
          { target: { image: "error.png" } },
          { id: "error" }
        ),
      ],
      connections: {
        "try-1": {
          success: [[{ action: "success", type: "main", index: 0 }]],
          error: [[{ action: "error", type: "main", index: 0 }]],
        },
      },
    };

    expect(getActionOutputCount("TRY_CATCH")).toBe(2);
    expect(getNextActions(workflow, "try-1", "success")).toEqual(["success"]);
    expect(getNextActions(workflow, "try-1", "error")).toEqual(["error"]);
    expect(isWorkflowValid(workflow)).toBe(true);
  });
});
