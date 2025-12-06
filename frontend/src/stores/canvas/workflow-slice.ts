/**
 * Workflow Slice - Manages workflow state and validation
 *
 * Responsibilities:
 * - Loading/saving workflows
 * - Workflow validation
 * - Dirty state tracking
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, WorkflowSlice, Workflow } from "./types";

export const createWorkflowSlice: StateCreator<
  CanvasStore,
  [["zustand/immer", never]],
  [],
  WorkflowSlice
> = (set, get) => ({
  // State
  workflow: null,
  isDirty: false,
  validationResult: null,
  isValidating: false,

  // Actions
  setWorkflow: (workflow: Workflow) => {
    set((state) => {
      state.workflow = workflow;
      state.isDirty = false;
      state.validationResult = null;
      state.selectedNodes = [];
      state.selectedEdges = [];
      state.history = [];
      state.historyIndex = -1;
    });
    get().recordHistory("Load workflow");
  },

  clearWorkflow: () => {
    set((state) => {
      state.workflow = null;
      state.isDirty = false;
      state.validationResult = null;
      state.selectedNodes = [];
      state.selectedEdges = [];
      state.history = [];
      state.historyIndex = -1;
    });
  },

  saveWorkflow: async (projectId?: string) => {
    const workflow = get().workflow;
    if (!workflow) {
      throw new Error("No workflow to save");
    }

    if (!projectId) {
      // If no projectId provided, just mark as clean (for local-only mode)
      set((state) => {
        state.isDirty = false;
      });
      return;
    }

    try {
      // Import API client dynamically to avoid circular dependencies
      const { apiClient } = await import("@/lib/api-client");

      // Get current project to merge workflow into configuration
      const project = await apiClient.getProject(parseInt(projectId));

      // Update project configuration with workflow
      const updatedConfig = {
        ...project.configuration,
        workflow,
      };

      await apiClient.updateProject(parseInt(projectId), {
        configuration: updatedConfig,
      });

      set((state) => {
        state.isDirty = false;
      });
    } catch (error) {
      console.error("Failed to save workflow:", error);
      throw error;
    }
  },

  validateWorkflow: () => {
    const { workflow } = get();
    if (!workflow) {
      return { valid: true, errors: [], warnings: [] };
    }

    // Import validation functions from canvas-validation
    const { validateWorkflow: validate } = require("../../canvas-validation");

    // Run comprehensive validation
    const result = validate(workflow, {
      checkCycles: true,
      checkOrphaned: true,
      checkMissingConnections: true,
      checkInvalidConnections: true,
      checkVariables: true,
      checkConfigs: true,
      checkUnreachable: true,
    });

    set((state) => {
      state.validationResult = result;
    });

    return result;
  },

  clearValidation: () => {
    set((state) => {
      state.validationResult = null;
    });
  },
});
