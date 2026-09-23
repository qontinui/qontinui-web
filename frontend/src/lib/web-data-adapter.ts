/**
 * Web Data Adapter for @qontinui/workflow-ui
 *
 * Implements the WorkflowDataAdapter interface using the existing web frontend
 * API services. This bridges the shared workflow-ui package with the web app's
 * runner API client and library service.
 */

import type { WorkflowDataAdapter } from "@qontinui/workflow-ui";
import type {
  UnifiedWorkflow,
  SkillDefinition,
} from "@qontinui/shared-types/workflow";
import type { LibraryItem } from "@qontinui/shared-types/library";
import { runnerFetch } from "@/lib/runner/api-client";
import type { RunnerTarget } from "@/lib/runner/target";
import * as workflowApi from "@/lib/api/unified-workflows";

/**
 * Create a WorkflowDataAdapter backed by the runner API of `target`.
 *
 * Library items are fetched from the target runner's REST endpoints (the
 * transport is resolved per request). Workflow CRUD goes through the
 * unified-workflows API client.
 */
export function createWebDataAdapter(
  target: RunnerTarget
): WorkflowDataAdapter {
  return {
    async fetchPrompts(): Promise<LibraryItem[]> {
      return runnerFetch<LibraryItem[]>(target, "/prompts");
    },

    async fetchChecks(): Promise<LibraryItem[]> {
      return runnerFetch<LibraryItem[]>(target, "/checks");
    },

    async fetchCheckGroups(): Promise<LibraryItem[]> {
      return runnerFetch<LibraryItem[]>(target, "/check-groups");
    },

    async fetchShellCommands(): Promise<LibraryItem[]> {
      return runnerFetch<LibraryItem[]>(target, "/shell-commands");
    },

    async fetchWorkflows(): Promise<UnifiedWorkflow[]> {
      return workflowApi.listWorkflows();
    },

    async fetchPlaywrightScripts(): Promise<LibraryItem[]> {
      return runnerFetch<LibraryItem[]>(target, "/playwright/tests");
    },

    async fetchContexts(): Promise<LibraryItem[]> {
      return runnerFetch<LibraryItem[]>(target, "/contexts");
    },

    async fetchSkills(): Promise<SkillDefinition[]> {
      try {
        const skills = await runnerFetch<SkillDefinition[]>(target, "/skills");
        return (skills ?? []).filter((s) => s.source !== "builtin");
      } catch {
        return [];
      }
    },

    async saveWorkflow(workflow: UnifiedWorkflow): Promise<UnifiedWorkflow> {
      // Determine create vs update by checking if the workflow already exists
      // on the server. If id is empty or not yet saved, create; otherwise update.
      if (!workflow.id || workflow.id === "") {
        return workflowApi.createWorkflow(workflow);
      }
      try {
        return await workflowApi.updateWorkflow(workflow.id, workflow);
      } catch {
        // If update fails (404), try creating instead
        return workflowApi.createWorkflow(workflow);
      }
    },

    async loadWorkflow(id: string): Promise<UnifiedWorkflow> {
      return workflowApi.getWorkflow(id);
    },

    async deleteWorkflow(id: string): Promise<void> {
      return workflowApi.deleteWorkflow(id);
    },

    async listWorkflows(): Promise<UnifiedWorkflow[]> {
      return workflowApi.listWorkflows();
    },
  };
}
