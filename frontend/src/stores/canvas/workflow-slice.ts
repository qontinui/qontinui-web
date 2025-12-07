/**
 * Workflow Slice - Manages workflow state and validation
 *
 * Responsibilities:
 * - Loading/clearing workflows
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
