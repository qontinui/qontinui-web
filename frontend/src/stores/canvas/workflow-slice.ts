/**
 * Workflow Slice - Manages workflow state and validation
 *
 * Responsibilities:
 * - Loading/saving workflows
 * - Workflow validation
 * - Dirty state tracking
 */

import type { StateCreator } from "zustand";
import type {
  CanvasStore,
  WorkflowSlice,
  Workflow,
  ValidationResult,
  ValidationError,
} from "./types";

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

  saveWorkflow: async () => {
    const workflow = get().workflow;
    if (!workflow) return;

    // TODO: Implement actual save to backend
    console.log("Saving workflow:", workflow);

    set((state) => {
      state.isDirty = false;
    });
  },

  validateWorkflow: () => {
    const { workflow } = get();
    if (!workflow) {
      return { valid: true, errors: [], warnings: [] };
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // TODO: Implement comprehensive validation
    // - Connection validity (output types match)
    // - Cycle detection
    // - Orphaned action detection
    // - Missing connections (IF without true/false)
    // - Variable references

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

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
