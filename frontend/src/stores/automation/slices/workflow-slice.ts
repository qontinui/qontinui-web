/**
 * Workflow Slice
 *
 * Manages workflow CRUD operations.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, WorkflowSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";

export const createWorkflowSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  WorkflowSlice
> = (set, get) => ({
  // Initial state
  workflows: [],

  // Actions
  setWorkflows: (workflows) => {
    projectLogger.debug("WorkflowSlice", "setWorkflows", {
      count: workflows.length,
    });
    set((state) => {
      state.workflows = workflows;
    });
  },

  addWorkflow: (workflow) => {
    projectLogger.info("WorkflowSlice", "addWorkflow", {
      id: workflow.id,
      name: workflow.name,
    });
    set((state) => {
      state.workflows.push(workflow);
    });
    get().triggerSave();
  },

  updateWorkflow: (workflow) => {
    projectLogger.debug("WorkflowSlice", "updateWorkflow", {
      id: workflow.id,
      name: workflow.name,
    });
    set((state) => {
      const index = state.workflows.findIndex((w) => w.id === workflow.id);
      if (index !== -1) {
        state.workflows[index] = workflow;
      }
    });
    get().triggerSave();
  },

  deleteWorkflow: (workflowId) => {
    projectLogger.info("WorkflowSlice", "deleteWorkflow", { workflowId });
    set((state) => {
      state.workflows = state.workflows.filter((w) => w.id !== workflowId);
    });
    // Clean up transitions that reference this workflow
    get().removeWorkflowFromTransitions(workflowId);
    get().triggerSave();
  },

  deleteWorkflows: (workflowIds) => {
    projectLogger.info("WorkflowSlice", "deleteWorkflows", {
      count: workflowIds.length,
      ids: workflowIds,
    });
    const idsSet = new Set(workflowIds);
    set((state) => {
      state.workflows = state.workflows.filter((w) => !idsSet.has(w.id));
    });
    // Clean up transitions that reference these workflows
    workflowIds.forEach((workflowId) => {
      get().removeWorkflowFromTransitions(workflowId);
    });
    get().triggerSave();
  },
});
