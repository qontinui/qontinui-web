/**
 * Comprehensive tests for Workflow File Manager
 *
 * Tests:
 * - Load/save workflows
 * - Import/export
 * - Validation
 * - Auto-fix
 * - File format handling
 * - Error handling
 */

import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { WorkflowFileManager } from "./workflow-file-manager";
import { Workflow } from "../lib/action-schema/action-types";

describe("WorkflowFileManager", () => {
  let manager: WorkflowFileManager;
  let testWorkflow: Workflow;

  beforeEach(() => {
    manager = WorkflowFileManager.getInstance();
    localStorage.clear();

    testWorkflow = {
      id: "test-workflow-1",
      name: "Test Workflow",
      version: "1.0.0",
      format: "graph",
      actions: [
        {
          id: "action-1",
          type: "CLICK",
          config: { target: { image: "button.png" } },
          position: [100, 100],
        },
      ],
      connections: {},
      metadata: {
        created: new Date().toISOString(),
      },
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ==========================================================================
  // Save/Load Tests
  // ==========================================================================

  describe("Save and Load", () => {
    test("should save workflow to localStorage", async () => {
      const result = await manager.saveWorkflow(testWorkflow);

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();

      const stored = localStorage.getItem(result.path!);
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored!);
      expect(parsed.id).toBe(testWorkflow.id);
      expect(parsed.name).toBe(testWorkflow.name);
    });

    test("should load workflow from localStorage", async () => {
      await manager.saveWorkflow(testWorkflow);
      const key = `workflow:${testWorkflow.id}`;

      const result = await manager.loadWorkflowFromStorage(key);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();
      expect(result.workflow?.id).toBe(testWorkflow.id);
      expect(result.workflow?.name).toBe(testWorkflow.name);
    });

    test("should update metadata on save", async () => {
      const result = await manager.saveWorkflow(testWorkflow);
      expect(result.success).toBe(true);

      const key = `workflow:${testWorkflow.id}`;
      const stored = localStorage.getItem(key);
      const parsed = JSON.parse(stored!);

      expect(parsed.metadata.updated).toBeDefined();
    });

    test("should fail to save invalid workflow", async () => {
      const invalidWorkflow = {
        ...testWorkflow,
        id: "",
      };

      const result = await manager.saveWorkflow(invalidWorkflow as Workflow);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("should return error for non-existent workflow", async () => {
      const result = await manager.loadWorkflowFromStorage("non-existent-key");

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // List Workflows Tests
  // ==========================================================================

  describe("List Workflows", () => {
    test("should list all saved workflows", async () => {
      await manager.saveWorkflow(testWorkflow);
      await manager.saveWorkflow({
        ...testWorkflow,
        id: "test-workflow-2",
        name: "Test Workflow 2",
      });

      const keys = manager.listWorkflows();

      expect(keys.length).toBe(2);
      expect(keys).toContain(`workflow:${testWorkflow.id}`);
      expect(keys).toContain("workflow:test-workflow-2");
    });

    test("should return empty array when no workflows", () => {
      const keys = manager.listWorkflows();
      expect(keys).toEqual([]);
    });
  });

  // ==========================================================================
  // Delete Workflow Tests
  // ==========================================================================

  describe("Delete Workflow", () => {
    test("should delete workflow", async () => {
      await manager.saveWorkflow(testWorkflow);
      const key = `workflow:${testWorkflow.id}`;

      const result = await manager.deleteWorkflow(key);

      expect(result.success).toBe(true);
      expect(localStorage.getItem(key)).toBeNull();
    });

    test("should succeed even if workflow does not exist", async () => {
      const result = await manager.deleteWorkflow("non-existent-key");

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Load from String Tests
  // ==========================================================================

  describe("Load from String", () => {
    test("should load workflow from JSON string", async () => {
      const json = JSON.stringify(testWorkflow);

      const result = await manager.loadWorkflowFromString(json);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();
      expect(result.workflow?.id).toBe(testWorkflow.id);
    });

    test("should fail on invalid JSON", async () => {
      const invalidJson = "{ invalid json }";

      const result = await manager.loadWorkflowFromString(invalidJson);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should validate workflow on load", async () => {
      const invalidWorkflow = {
        ...testWorkflow,
        actions: "not an array", // Invalid
      };
      const json = JSON.stringify(invalidWorkflow);

      const result = await manager.loadWorkflowFromString(json);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should auto-fix workflow if requested", async () => {
      const fixableWorkflow = {
        ...testWorkflow,
        id: "", // Missing ID - can be fixed
      };
      const json = JSON.stringify(fixableWorkflow);

      const result = await manager.loadWorkflowFromString(json, {
        validate: true,
        autoFix: true,
      });

      // With auto-fix, it should succeed
      expect(result.workflow).toBeDefined();
      expect(result.workflow?.id).toBeTruthy();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Export Tests
  // ==========================================================================

  describe("Export", () => {
    test("should export workflow to string", () => {
      const exported = manager.exportToString(testWorkflow);

      expect(exported).toBeDefined();
      expect(typeof exported).toBe("string");

      const parsed = JSON.parse(exported);
      expect(parsed.id).toBe(testWorkflow.id);
    });

    test("should export with pretty formatting", () => {
      const exported = manager.exportToString(testWorkflow, true);

      expect(exported).toContain("\n");
      expect(exported).toContain("  ");
    });

    test("should export without pretty formatting", () => {
      const exported = manager.exportToString(testWorkflow, false);

      expect(exported).not.toContain("\n  ");
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe("Validation", () => {
    test("should validate correct workflow", () => {
      const result = manager.validateWorkflow(testWorkflow);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test("should detect missing required fields", () => {
      const invalidWorkflow = {
        ...testWorkflow,
        name: "",
      };

      const result = manager.validateWorkflow(invalidWorkflow);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should detect invalid actions array", () => {
      const invalidWorkflow = {
        ...testWorkflow,
        actions: "not an array",
      };

      const result = manager.validateWorkflow(invalidWorkflow as any);

      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Auto-Fix Tests
  // ==========================================================================

  describe("Auto-Fix", () => {
    test("should fix missing workflow ID", () => {
      const fixableWorkflow = {
        ...testWorkflow,
        id: "",
      };

      const result = manager.autoFixWorkflow(fixableWorkflow as Workflow);

      expect(result.fixed).toBe(true);
      expect(result.workflow.id).toBeTruthy();
      expect(result.changes.length).toBeGreaterThan(0);
    });

    test("should fix missing workflow name", () => {
      const fixableWorkflow = {
        ...testWorkflow,
        name: "",
      };

      const result = manager.autoFixWorkflow(fixableWorkflow as Workflow);

      expect(result.fixed).toBe(true);
      expect(result.workflow.name).toBe("Untitled Workflow");
    });

    test("should fix missing version", () => {
      const fixableWorkflow = {
        ...testWorkflow,
        version: "",
      };

      const result = manager.autoFixWorkflow(fixableWorkflow as Workflow);

      expect(result.fixed).toBe(true);
      expect(result.workflow.version).toBeTruthy();
    });

    test("should fix missing format", () => {
      const fixableWorkflow: any = {
        ...testWorkflow,
      };
      delete fixableWorkflow.format;

      const result = manager.autoFixWorkflow(fixableWorkflow);

      expect(result.fixed).toBe(true);
      expect(result.workflow.format).toBe("graph");
    });

    test("should fix missing connections", () => {
      const fixableWorkflow: any = {
        ...testWorkflow,
        format: "graph",
      };
      delete fixableWorkflow.connections;

      const result = manager.autoFixWorkflow(fixableWorkflow);

      expect(result.fixed).toBe(true);
      expect(result.workflow.connections).toBeDefined();
    });

    test("should fix missing positions", () => {
      const fixableWorkflow = {
        ...testWorkflow,
        format: "graph" as const,
        actions: [
          {
            id: "action-1",
            type: "CLICK" as const,
            config: { target: { image: "button.png" } },
            // Missing position
          },
        ],
      };

      const result = manager.autoFixWorkflow(fixableWorkflow as any);

      expect(result.fixed).toBe(true);
      expect(result.workflow.actions[0].position).toBeDefined();
      expect(Array.isArray(result.workflow.actions[0].position)).toBe(true);
    });

    test("should remove invalid connections", () => {
      const fixableWorkflow = {
        ...testWorkflow,
        connections: {
          "action-1": {
            main: [
              [{ action: "non-existent", type: "main" as const, index: 0 }],
            ],
          },
        },
      };

      const result = manager.autoFixWorkflow(fixableWorkflow);

      expect(result.fixed).toBe(true);
      expect(Object.keys(result.workflow.connections).length).toBe(0);
    });

    test("should not fix valid workflow", () => {
      const result = manager.autoFixWorkflow(testWorkflow);

      expect(result.fixed).toBe(false);
      expect(result.changes.length).toBe(0);
    });
  });

  // ==========================================================================
  // Export to Clipboard Tests
  // ==========================================================================

  describe("Export to Clipboard", () => {
    test("should export to clipboard", async () => {
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });

      const result = await manager.exportToClipboard(testWorkflow);

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Static Methods Tests
  // ==========================================================================

  describe("Static Methods", () => {
    test("should get file extension", () => {
      const ext = WorkflowFileManager.getFileExtension();

      expect(ext).toBe(".qontinui.json");
    });

    test("should get current version", () => {
      const version = WorkflowFileManager.getCurrentVersion();

      expect(version).toBe("1.0.0");
    });
  });
});
