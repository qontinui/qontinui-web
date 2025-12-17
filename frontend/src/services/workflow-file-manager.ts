/**
 * Workflow File Manager - Load, save, import, export workflows
 *
 * Handles all file operations for workflows including:
 * - Loading workflows from JSON files
 * - Saving workflows to JSON files
 * - Importing workflows (file upload)
 * - Exporting workflows (JSON download)
 * - Validation on load
 * - Auto-fix common issues
 * - Version migration
 */

import { Workflow } from "../lib/action-schema/action-types";
import {
  validateWorkflow,
  ValidationResult,
  ValidationError,
} from "../lib/action-schema/workflow-validation";
import { migrateWorkflow, detectWorkflowVersion } from "./workflow-migration";

// ============================================================================
// Types
// ============================================================================

export interface LoadResult {
  success: boolean;
  workflow?: Workflow;
  errors: ValidationError[];
  warnings: string[];
  migrated: boolean;
  originalVersion?: string;
}

export interface SaveResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface ExportOptions {
  filename?: string;
  pretty?: boolean;
  includeMetadata?: boolean;
}

export interface ImportOptions {
  validate?: boolean;
  autoFix?: boolean;
  migrate?: boolean;
}

export interface AutoFixResult {
  fixed: boolean;
  changes: string[];
  workflow: Workflow;
}

// ============================================================================
// Constants
// ============================================================================

const CURRENT_WORKFLOW_VERSION = "1.0.0";
const WORKFLOW_FILE_EXTENSION = ".qontinui.json";

// ============================================================================
// WorkflowFileManager Class
// ============================================================================

export class WorkflowFileManager {
  private static instance: WorkflowFileManager;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowFileManager {
    if (!WorkflowFileManager.instance) {
      WorkflowFileManager.instance = new WorkflowFileManager();
    }
    return WorkflowFileManager.instance;
  }

  // ==========================================================================
  // Load Workflow
  // ==========================================================================

  /**
   * Load workflow from File object
   */
  async loadWorkflow(
    file: File,
    options: ImportOptions = {}
  ): Promise<LoadResult> {
    const { validate = true, autoFix = true, migrate = true } = options;

    const result: LoadResult = {
      success: false,
      errors: [],
      warnings: [],
      migrated: false,
    };

    try {
      // Read file contents
      const content = await this.readFileAsText(file);

      // Parse JSON
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch (parseError) {
        result.errors.push({
          type: "missing_action",
          message: `Invalid JSON: ${parseError instanceof Error ? parseError.message : "Parse error"}`,
        });
        return result;
      }

      // Detect version
      const detectedVersion = detectWorkflowVersion(data);
      result.originalVersion = detectedVersion;

      // Migrate if needed
      let workflow = data as Workflow;
      if (migrate && detectedVersion !== CURRENT_WORKFLOW_VERSION) {
        try {
          workflow = migrateWorkflow(data, detectedVersion);
          result.migrated = true;
          result.warnings.push(
            `Workflow migrated from version ${detectedVersion} to ${CURRENT_WORKFLOW_VERSION}`
          );
        } catch (migrateError) {
          result.errors.push({
            type: "missing_action",
            message: `Migration failed: ${migrateError instanceof Error ? migrateError.message : "Unknown error"}`,
          });
          return result;
        }
      }

      // Validate if requested
      if (validate) {
        const validationResult = validateWorkflow(workflow);
        result.errors.push(...validationResult.errors);

        if (!validationResult.valid && autoFix) {
          // Attempt auto-fix
          const fixResult = this.autoFixWorkflow(workflow);
          if (fixResult.fixed) {
            workflow = fixResult.workflow;
            result.warnings.push(
              ...fixResult.changes.map((c) => `Auto-fixed: ${c}`)
            );

            // Re-validate after fixing
            const revalidation = validateWorkflow(workflow);
            result.errors = revalidation.errors;
          }
        }
      }

      // Final check
      result.success = result.errors.length === 0;
      result.workflow = workflow;

      return result;
    } catch (error) {
      result.errors.push({
        type: "missing_action",
        message: `Failed to load workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      return result;
    }
  }

  /**
   * Load workflow from JSON string
   */
  async loadWorkflowFromString(
    jsonString: string,
    options: ImportOptions = {}
  ): Promise<LoadResult> {
    // Create a virtual File object
    const blob = new Blob([jsonString], { type: "application/json" });
    const file = new File([blob], "workflow.json", {
      type: "application/json",
    });
    return this.loadWorkflow(file, options);
  }

  /**
   * Load workflow from URL
   */
  async loadWorkflowFromUrl(
    url: string,
    options: ImportOptions = {}
  ): Promise<LoadResult> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          success: false,
          errors: [
            {
              type: "missing_action",
              message: `Failed to fetch workflow: ${response.statusText}`,
            },
          ],
          warnings: [],
          migrated: false,
        };
      }

      const content = await response.text();
      return this.loadWorkflowFromString(content, options);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            type: "missing_action",
            message: `Failed to load workflow from URL: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        warnings: [],
        migrated: false,
      };
    }
  }

  // ==========================================================================
  // Save Workflow
  // ==========================================================================

  /**
   * Save workflow to localStorage
   */
  async saveWorkflow(workflow: Workflow, key?: string): Promise<SaveResult> {
    try {
      // Validate before saving
      const validation = validateWorkflow(workflow);
      if (!validation.valid) {
        return {
          success: false,
          error: `Workflow validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
        };
      }

      // Update metadata
      const workflowToSave = {
        ...workflow,
        metadata: {
          ...workflow.metadata,
          updated: new Date().toISOString(),
        },
      };

      // Save to localStorage
      const storageKey = key || `workflow:${workflow.id}`;
      const json = JSON.stringify(workflowToSave);
      localStorage.setItem(storageKey, json);

      return {
        success: true,
        path: storageKey,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Load workflow from localStorage
   */
  async loadWorkflowFromStorage(key: string): Promise<LoadResult> {
    try {
      const json = localStorage.getItem(key);
      if (!json) {
        return {
          success: false,
          errors: [
            {
              type: "missing_action",
              message: `Workflow not found in storage: ${key}`,
            },
          ],
          warnings: [],
          migrated: false,
        };
      }

      return this.loadWorkflowFromString(json);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            type: "missing_action",
            message: `Failed to load workflow from storage: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        warnings: [],
        migrated: false,
      };
    }
  }

  /**
   * Delete workflow from localStorage
   */
  async deleteWorkflow(key: string): Promise<SaveResult> {
    try {
      localStorage.removeItem(key);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * List all workflows in localStorage
   */
  listWorkflows(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("workflow:")) {
        keys.push(key);
      }
    }
    return keys;
  }

  // ==========================================================================
  // Import Workflow
  // ==========================================================================

  /**
   * Import workflow from file picker
   */
  async importWorkflow(options: ImportOptions = {}): Promise<LoadResult> {
    return new Promise((resolve) => {
      // Create file input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.qontinui.json";
      input.multiple = false;

      input.onchange = async (e) => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];

        if (!file) {
          resolve({
            success: false,
            errors: [{ type: "missing_action", message: "No file selected" }],
            warnings: [],
            migrated: false,
          });
          return;
        }

        const result = await this.loadWorkflow(file, options);
        resolve(result);
      };

      input.oncancel = () => {
        resolve({
          success: false,
          errors: [{ type: "missing_action", message: "Import cancelled" }],
          warnings: [],
          migrated: false,
        });
      };

      // Trigger file picker
      input.click();
    });
  }

  /**
   * Import workflow from clipboard
   */
  async importFromClipboard(options: ImportOptions = {}): Promise<LoadResult> {
    try {
      const text = await navigator.clipboard.readText();
      return this.loadWorkflowFromString(text, options);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            type: "missing_action",
            message: `Failed to read from clipboard: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        warnings: [],
        migrated: false,
      };
    }
  }

  /**
   * Import workflow from drag-and-drop
   */
  async importFromDrop(
    event: DragEvent,
    options: ImportOptions = {}
  ): Promise<LoadResult> {
    try {
      const file = event.dataTransfer?.files[0];
      if (!file) {
        return {
          success: false,
          errors: [
            { type: "missing_action", message: "No file in drop event" },
          ],
          warnings: [],
          migrated: false,
        };
      }

      return this.loadWorkflow(file, options);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            type: "missing_action",
            message: `Failed to import from drop: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        warnings: [],
        migrated: false,
      };
    }
  }

  // ==========================================================================
  // Export Workflow
  // ==========================================================================

  /**
   * Export workflow as JSON download
   */
  exportWorkflow(workflow: Workflow, options: ExportOptions = {}): void {
    console.log("[WorkflowFileManager] exportWorkflow called", {
      hasWorkflow: !!workflow,
      workflowType: typeof workflow,
      workflowKeys: workflow ? Object.keys(workflow) : [],
      workflowName: workflow?.name,
      workflowId: workflow?.id,
      options,
    });

    const { filename, pretty = true, includeMetadata = true } = options;

    if (!workflow) {
      throw new Error("Workflow is undefined - cannot export");
    }

    if (!workflow.name) {
      throw new Error(
        "Workflow has no name property - cannot generate filename"
      );
    }

    // Prepare workflow for export
    const exportWorkflow = includeMetadata
      ? {
          ...workflow,
          metadata: {
            ...workflow.metadata,
            exported: new Date().toISOString(),
            exportedBy: "Qontinui",
          },
        }
      : workflow;

    console.log("[WorkflowFileManager] Prepared export workflow", {
      hasMetadata: !!exportWorkflow.metadata,
      actionsCount: exportWorkflow.actions?.length,
    });

    // Convert to JSON
    const json = pretty
      ? JSON.stringify(exportWorkflow, null, 2)
      : JSON.stringify(exportWorkflow);

    console.log("[WorkflowFileManager] JSON stringified", {
      jsonLength: json.length,
    });

    // Generate filename
    const finalFilename =
      filename ||
      `${workflow.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}${WORKFLOW_FILE_EXTENSION}`;

    console.log("[WorkflowFileManager] Generated filename", { finalFilename });

    // Create download
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = finalFilename;
    link.click();

    console.log("[WorkflowFileManager] Download triggered");

    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Export workflow to clipboard
   */
  async exportToClipboard(workflow: Workflow, pretty = true): Promise<boolean> {
    try {
      const json = pretty
        ? JSON.stringify(workflow, null, 2)
        : JSON.stringify(workflow);
      await navigator.clipboard.writeText(json);
      return true;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      return false;
    }
  }

  /**
   * Export workflow as string
   */
  exportToString(workflow: Workflow, pretty = true): string {
    return pretty
      ? JSON.stringify(workflow, null, 2)
      : JSON.stringify(workflow);
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate workflow data
   */
  validateWorkflow(data: unknown): ValidationResult {
    try {
      const workflow = data as Workflow;
      return validateWorkflow(workflow);
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            type: "missing_action",
            message: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }

  // ==========================================================================
  // Auto-Fix
  // ==========================================================================

  /**
   * Attempt to automatically fix common workflow issues
   */
  autoFixWorkflow(workflow: Workflow): AutoFixResult {
    const changes: string[] = [];
    let fixed = false;
    const fixedWorkflow = { ...workflow };

    // Fix 1: Ensure workflow has required fields
    if (!fixedWorkflow.id) {
      fixedWorkflow.id = `workflow-${Date.now()}`;
      changes.push("Generated missing workflow ID");
      fixed = true;
    }

    if (!fixedWorkflow.name) {
      fixedWorkflow.name = "Untitled Workflow";
      changes.push("Set default workflow name");
      fixed = true;
    }

    if (!fixedWorkflow.version) {
      fixedWorkflow.version = CURRENT_WORKFLOW_VERSION;
      changes.push("Set default workflow version");
      fixed = true;
    }

    // Fix 2: Ensure format is set
    if (!fixedWorkflow.format) {
      // Detect format based on presence of connections
      if (
        fixedWorkflow.connections &&
        Object.keys(fixedWorkflow.connections).length > 0
      ) {
        fixedWorkflow.format = "graph";
        changes.push("Set format to graph based on connections");
      } else {
        fixedWorkflow.format = "graph";
        changes.push("Set default format to graph");
      }
      fixed = true;
    }

    // Fix 3: Ensure connections exist for graph format
    if (fixedWorkflow.format === "graph" && !fixedWorkflow.connections) {
      fixedWorkflow.connections = {};
      changes.push("Added missing connections object");
      fixed = true;
    }

    // Fix 4: Ensure actions have positions for graph format
    if (fixedWorkflow.format === "graph") {
      fixedWorkflow.actions = fixedWorkflow.actions.map((action, index) => {
        if (!action.position) {
          const x = 100 + (index % 3) * 300;
          const y = 100 + Math.floor(index / 3) * 200;
          changes.push(`Added position [${x}, ${y}] to action ${action.id}`);
          fixed = true;
          return { ...action, position: [x, y] as [number, number] };
        }
        return action;
      });
    }

    // Fix 5: Remove invalid connections (references to non-existent actions)
    if (fixedWorkflow.connections) {
      const actionIds = new Set(fixedWorkflow.actions.map((a) => a.id));
      const cleanedConnections: typeof fixedWorkflow.connections = {};

      Object.entries(fixedWorkflow.connections).forEach(
        ([sourceId, outputs]) => {
          if (!actionIds.has(sourceId)) {
            changes.push(
              `Removed connections from non-existent action ${sourceId}`
            );
            fixed = true;
            return;
          }

          cleanedConnections[sourceId] = {};

          ["main", "error", "success", "parallel"].forEach((type) => {
            const connections = outputs[type as keyof typeof outputs];
            if (connections) {
              const cleanedOutputs = connections.map((outputConnections) =>
                outputConnections.filter((conn) => {
                  if (!actionIds.has(conn.action)) {
                    changes.push(
                      `Removed invalid connection from ${sourceId} to ${conn.action}`
                    );
                    fixed = true;
                    return false;
                  }
                  return true;
                })
              );

              // Only include non-empty output arrays
              const nonEmptyOutputs = cleanedOutputs.filter(
                (arr) => arr.length > 0
              );
              if (nonEmptyOutputs.length > 0) {
                (cleanedConnections[sourceId] as Record<string, unknown>)[
                  type
                ] = nonEmptyOutputs;
              }
            }
          });

          // Only include source if it has connections
          if (Object.keys(cleanedConnections[sourceId]).length === 0) {
            delete cleanedConnections[sourceId];
          }
        }
      );

      fixedWorkflow.connections = cleanedConnections;
    }

    // Fix 6: Initialize metadata if missing
    if (!fixedWorkflow.metadata) {
      fixedWorkflow.metadata = {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      changes.push("Added missing metadata");
      fixed = true;
    }

    // Fix 7: Ensure actions array exists
    if (!fixedWorkflow.actions) {
      fixedWorkflow.actions = [];
      changes.push("Added missing actions array");
      fixed = true;
    }

    return {
      fixed,
      changes,
      workflow: fixedWorkflow,
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Read file as text
   */
  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  /**
   * Get workflow file extension
   */
  static getFileExtension(): string {
    return WORKFLOW_FILE_EXTENSION;
  }

  /**
   * Get current workflow version
   */
  static getCurrentVersion(): string {
    return CURRENT_WORKFLOW_VERSION;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowFileManager = WorkflowFileManager.getInstance();
