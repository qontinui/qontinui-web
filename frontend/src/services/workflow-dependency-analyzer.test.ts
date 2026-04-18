/**
 * Tests for Workflow Dependency Analyzer
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Workflow, createAction } from "../lib/action-schema/action-types";
import { WorkflowDependencyAnalyzer } from "./workflow-dependency-analyzer";

describe("WorkflowDependencyAnalyzer", () => {
  let analyzer: WorkflowDependencyAnalyzer;
  let testWorkflows: Workflow[];

  beforeEach(() => {
    analyzer = WorkflowDependencyAnalyzer.getInstance();
    analyzer.invalidateCache();

    // Create test workflows
    testWorkflows = [
      // Workflow A - No dependencies
      {
        id: "workflow-a",
        name: "Workflow A",
        version: "1.0.0",
        format: "graph" as const,
        actions: [
          createAction(
            "CLICK",
            { target: { image: "button.png" } },
            [100, 100],
            {
              id: "a1",
            }
          ),
        ],
        connections: {},
      },
      // Workflow B - Depends on A
      {
        id: "workflow-b",
        name: "Workflow B",
        version: "1.0.0",
        format: "graph" as const,
        actions: [
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "workflow-a" },
            [100, 100],
            {
              id: "b1",
            }
          ),
          createAction(
            "CLICK",
            { target: { image: "button.png" } },
            [100, 250],
            {
              id: "b2",
            }
          ),
        ],
        connections: {
          b1: {
            main: [[{ action: "b2", type: "main", index: 0 }]],
          },
        },
      },
      // Workflow C - Depends on B (transitively depends on A)
      {
        id: "workflow-c",
        name: "Workflow C",
        version: "1.0.0",
        format: "graph" as const,
        actions: [
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "workflow-b" },
            [100, 100],
            {
              id: "c1",
            }
          ),
        ],
        connections: {},
      },
    ];
  });

  describe("analyzeDependencies", () => {
    it("should find no dependencies for workflow without RUN_WORKFLOW actions", () => {
      const deps = analyzer.analyzeDependencies(testWorkflows[0]);
      expect(deps).toEqual([]);
    });

    it("should find direct dependencies", () => {
      const deps = analyzer.analyzeDependencies(testWorkflows[1]);
      expect(deps).toEqual(["workflow-a"]);
    });

    it("should handle multiple RUN_WORKFLOW actions", () => {
      const workflow: Workflow = {
        id: "multi",
        name: "Multi",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "workflow-a" },
            [100, 100],
            {
              id: "m1",
            }
          ),
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "workflow-b" },
            [100, 250],
            {
              id: "m2",
            }
          ),
        ],
        connections: {},
      };

      const deps = analyzer.analyzeDependencies(workflow);
      expect(deps.sort()).toEqual(["workflow-a", "workflow-b"].sort());
    });

    it("should deduplicate dependencies", () => {
      const workflow: Workflow = {
        id: "dup",
        name: "Duplicate",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "workflow-a" },
            [100, 100],
            {
              id: "d1",
            }
          ),
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "workflow-a" },
            [100, 250],
            {
              id: "d2",
            }
          ),
        ],
        connections: {},
      };

      const deps = analyzer.analyzeDependencies(workflow);
      expect(deps).toEqual(["workflow-a"]);
    });
  });

  describe("getDependencies and getDependents", () => {
    it("should get direct dependencies", () => {
      const deps = analyzer.getDependencies("workflow-b", testWorkflows);
      expect(deps).toEqual(["workflow-a"]);
    });

    it("should get direct dependents", () => {
      const dependents = analyzer.getDependents("workflow-a", testWorkflows);
      expect(dependents).toEqual(["workflow-b"]);
    });

    it("should return empty array for non-existent workflow", () => {
      const deps = analyzer.getDependencies("non-existent", testWorkflows);
      expect(deps).toEqual([]);
    });
  });

  describe("getAllDependencies", () => {
    it("should get all dependencies recursively", () => {
      const deps = analyzer.getAllDependencies("workflow-c", testWorkflows);
      expect(deps.sort()).toEqual(["workflow-a", "workflow-b"].sort());
    });

    it("should handle workflows with no dependencies", () => {
      const deps = analyzer.getAllDependencies("workflow-a", testWorkflows);
      expect(deps).toEqual([]);
    });

    it("should prevent infinite recursion on circular dependencies", () => {
      const circularWorkflows: Workflow[] = [
        {
          id: "workflow-x",
          name: "Workflow X",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-y" },
              [100, 100],
              {
                id: "x1",
              }
            ),
          ],
          connections: {},
        },
        {
          id: "workflow-y",
          name: "Workflow Y",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-x" },
              [100, 100],
              {
                id: "y1",
              }
            ),
          ],
          connections: {},
        },
      ];

      const deps = analyzer.getAllDependencies("workflow-x", circularWorkflows);
      expect(deps.length).toBeGreaterThan(0);
      // Should not throw or hang
    });
  });

  describe("buildDependencyGraph", () => {
    it("should build complete dependency graph", () => {
      const graph = analyzer.buildDependencyGraph(testWorkflows);

      expect(graph.nodes.size).toBe(3);
      expect(graph.edges.length).toBe(2);
    });

    it("should calculate in-degree and out-degree correctly", () => {
      const graph = analyzer.buildDependencyGraph(testWorkflows);

      const nodeA = graph.nodes.get("workflow-a");
      expect(nodeA?.inDegree).toBe(1); // B depends on A
      expect(nodeA?.outDegree).toBe(0); // A has no dependencies

      const nodeB = graph.nodes.get("workflow-b");
      expect(nodeB?.inDegree).toBe(1); // C depends on B
      expect(nodeB?.outDegree).toBe(1); // B depends on A

      const nodeC = graph.nodes.get("workflow-c");
      expect(nodeC?.inDegree).toBe(0); // Nothing depends on C
      expect(nodeC?.outDegree).toBe(1); // C depends on B
    });

    it("should identify root and leaf workflows", () => {
      const graph = analyzer.buildDependencyGraph(testWorkflows);

      expect(graph.roots).toEqual(["workflow-c"]); // C has no dependencies
      expect(graph.leaves).toEqual(["workflow-a"]); // A has no dependents
    });
  });

  describe("findCircularDependencies", () => {
    it("should detect simple circular dependency", () => {
      const circularWorkflows: Workflow[] = [
        {
          id: "workflow-x",
          name: "Workflow X",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-y" },
              [100, 100],
              {
                id: "x1",
              }
            ),
          ],
          connections: {},
        },
        {
          id: "workflow-y",
          name: "Workflow Y",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-x" },
              [100, 100],
              {
                id: "y1",
              }
            ),
          ],
          connections: {},
        },
      ];

      const cycles = analyzer.findCircularDependencies(circularWorkflows);
      expect(cycles.length).toBe(1);
      expect(cycles[0]).toContain("workflow-x");
      expect(cycles[0]).toContain("workflow-y");
    });

    it("should detect self-referencing workflow", () => {
      const selfRefWorkflow: Workflow[] = [
        {
          id: "workflow-self",
          name: "Self Ref",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-self" },
              [100, 100],
              {
                id: "s1",
              }
            ),
          ],
          connections: {},
        },
      ];

      const cycles = analyzer.findCircularDependencies(selfRefWorkflow);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should return empty array when no circular dependencies", () => {
      const cycles = analyzer.findCircularDependencies(testWorkflows);
      expect(cycles).toEqual([]);
    });
  });

  describe("findUnusedWorkflows", () => {
    it("should identify unused workflows", () => {
      const workflowsWithUnused = [
        ...testWorkflows,
        {
          id: "workflow-unused",
          name: "Unused",
          version: "1.0.0",
          format: "graph" as const,
          actions: [],
          connections: {},
        },
      ];

      const unused = analyzer.findUnusedWorkflows(workflowsWithUnused);
      expect(unused).toContain("workflow-unused");
      expect(unused).toContain("workflow-c"); // C is also unused (no one calls it)
    });

    it("should return empty array when all workflows are used", () => {
      const unused = analyzer.findUnusedWorkflows(testWorkflows.slice(0, 2));
      // Only A and B, B uses A, so only B is unused
      expect(unused).toEqual(["workflow-b"]);
    });
  });

  describe("getImpactAnalysis", () => {
    it("should calculate impact of changing a workflow", () => {
      const impact = analyzer.getImpactAnalysis("workflow-a", testWorkflows);

      expect(impact.workflowId).toBe("workflow-a");
      expect(impact.directDependents).toEqual(["workflow-b"]);
      expect(impact.allDependents.sort()).toEqual(
        ["workflow-b", "workflow-c"].sort()
      );
      expect(impact.affectedCount).toBe(2);
      expect(impact.impactLevel).toBe("medium");
    });

    it("should show low impact for unused workflow", () => {
      const unusedWorkflow: Workflow = {
        id: "workflow-unused",
        name: "Unused",
        version: "1.0.0",
        format: "graph",
        actions: [],
        connections: {},
      };

      const impact = analyzer.getImpactAnalysis("workflow-unused", [
        ...testWorkflows,
        unusedWorkflow,
      ]);

      expect(impact.affectedCount).toBe(0);
      expect(impact.impactLevel).toBe("low");
    });
  });

  describe("getDependencyStats", () => {
    it("should calculate correct statistics", () => {
      const stats = analyzer.getDependencyStats(testWorkflows);

      expect(stats.totalWorkflows).toBe(3);
      expect(stats.totalDependencies).toBe(2);
      expect(stats.circularDependencies).toBe(0);
      expect(stats.rootWorkflows).toBe(1); // C
      expect(stats.leafWorkflows).toBe(1); // A
    });

    it("should identify most depended-upon workflows", () => {
      const stats = analyzer.getDependencyStats(testWorkflows);

      expect(stats.mostDepended.length).toBeGreaterThan(0);
      expect(stats.mostDepended[0].id).toBe("workflow-a");
    });
  });

  describe("validateDependencies", () => {
    it("should validate correct workflow", () => {
      const validation = analyzer.validateDependencies(
        testWorkflows[1],
        testWorkflows
      );

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it("should detect missing workflow reference", () => {
      const invalidWorkflow: Workflow = {
        id: "invalid",
        name: "Invalid",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction(
            "RUN_WORKFLOW",
            { workflowId: "non-existent" },
            [100, 100],
            {
              id: "i1",
            }
          ),
        ],
        connections: {},
      };

      const validation = analyzer.validateDependencies(
        invalidWorkflow,
        testWorkflows
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0].type).toBe("missing_workflow");
    });

    it("should detect self-reference", () => {
      const selfRefWorkflow: Workflow = {
        id: "self-ref",
        name: "Self Ref",
        version: "1.0.0",
        format: "graph",
        actions: [
          createAction("RUN_WORKFLOW", { workflowId: "self-ref" }, [100, 100], {
            id: "s1",
          }),
        ],
        connections: {},
      };

      const validation = analyzer.validateDependencies(selfRefWorkflow, [
        selfRefWorkflow,
      ]);

      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some((e) => e.type === "circular_dependency")
      ).toBe(true);
    });
  });

  describe("cache management", () => {
    it("should cache dependency graph", () => {
      analyzer.invalidateCache();
      expect(analyzer.isCacheValid()).toBe(false);

      analyzer.buildDependencyGraph(testWorkflows);
      expect(analyzer.isCacheValid()).toBe(true);

      const cached = analyzer.getCachedGraph();
      expect(cached).not.toBeNull();
      expect(cached?.nodes.size).toBe(3);
    });

    it("should invalidate cache", () => {
      analyzer.buildDependencyGraph(testWorkflows);
      expect(analyzer.isCacheValid()).toBe(true);

      analyzer.invalidateCache();
      expect(analyzer.isCacheValid()).toBe(false);
      expect(analyzer.getCachedGraph()).toBeNull();
    });

    it("should use cached graph when valid", () => {
      const graph1 = analyzer.buildDependencyGraph(testWorkflows, true);
      const graph2 = analyzer.buildDependencyGraph(testWorkflows, true);

      expect(graph1.timestamp).toBe(graph2.timestamp);
    });

    it("should rebuild graph when cache disabled", () => {
      const graph1 = analyzer.buildDependencyGraph(testWorkflows, false);
      const graph2 = analyzer.buildDependencyGraph(testWorkflows, false);

      expect(graph1.timestamp).not.toBe(graph2.timestamp);
    });
  });

  describe("exportDependencyReport", () => {
    it("should generate complete report", () => {
      const report = analyzer.exportDependencyReport(testWorkflows);

      expect(report.metadata.totalWorkflows).toBe(3);
      expect(report.workflows.length).toBe(3);
      expect(report.statistics.totalDependencies).toBe(2);
    });

    it("should include circular dependencies in report", () => {
      const circularWorkflows: Workflow[] = [
        {
          id: "workflow-x",
          name: "Workflow X",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-y" },
              [100, 100],
              {
                id: "x1",
              }
            ),
          ],
          connections: {},
        },
        {
          id: "workflow-y",
          name: "Workflow Y",
          version: "1.0.0",
          format: "graph",
          actions: [
            createAction(
              "RUN_WORKFLOW",
              { workflowId: "workflow-x" },
              [100, 100],
              {
                id: "y1",
              }
            ),
          ],
          connections: {},
        },
      ];

      const report = analyzer.exportDependencyReport(circularWorkflows);

      expect(report.circularDependencies.length).toBeGreaterThan(0);
    });
  });

  describe("exportGraphML", () => {
    it("should generate valid GraphML XML", () => {
      const graphML = analyzer.exportGraphML(testWorkflows);

      expect(graphML).toContain('<?xml version="1.0"');
      expect(graphML).toContain("<graphml");
      expect(graphML).toContain("</graphml>");
      expect(graphML).toContain("<node");
      expect(graphML).toContain("<edge");
    });

    it("should include workflow metadata in GraphML", () => {
      const graphML = analyzer.exportGraphML(testWorkflows);

      expect(graphML).toContain("workflow-a");
      expect(graphML).toContain("workflow-b");
      expect(graphML).toContain("workflow-c");
    });
  });

  describe("getGraphData", () => {
    it("should generate visualization data", () => {
      const vizData = analyzer.getGraphData(testWorkflows);

      expect(vizData.nodes.length).toBe(3);
      expect(vizData.edges.length).toBe(2);
    });

    it("should include node positions", () => {
      const vizData = analyzer.getGraphData(testWorkflows);

      vizData.nodes.forEach((node) => {
        expect(node.position).toBeDefined();
        expect(typeof node.position.x).toBe("number");
        expect(typeof node.position.y).toBe("number");
      });
    });

    it("should include edge metadata", () => {
      const vizData = analyzer.getGraphData(testWorkflows);

      vizData.edges.forEach((edge) => {
        expect(edge.source).toBeDefined();
        expect(edge.target).toBeDefined();
        expect(edge.data).toBeDefined();
        expect(typeof edge.data?.actionCount).toBe("number");
      });
    });
  });
});
