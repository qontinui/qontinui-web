/**
 * Utility functions for extracting and tracking variables defined within workflows.
 *
 * This module scans workflow actions to find variables that are created or defined
 * during workflow execution, such as:
 * - SET_VARIABLE actions
 * - LOOP iterator variables
 * - Other action outputs
 */

import type { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowVariable {
  name: string;
  source: "SET_VARIABLE" | "LOOP_ITERATOR" | "GET_VARIABLE_OUTPUT";
  actionId: string;
}

/**
 * Extract all variable names defined within a workflow's actions.
 *
 * Scans through all actions in a workflow to find:
 * - SET_VARIABLE actions -> variableName
 * - LOOP actions -> iteratorVariable
 * - GET_VARIABLE actions -> outputVariable (if different from input)
 *
 * @param workflow - The workflow to scan
 * @returns Array of unique variable names defined in the workflow
 */
export function extractWorkflowVariables(
  workflow: Workflow | null | undefined
): WorkflowVariable[] {
  if (!workflow?.actions) {
    return [];
  }

  const variables: WorkflowVariable[] = [];
  const seenNames = new Set<string>();

  for (const action of workflow.actions) {
    const config = action.config as Record<string, unknown>;

    // SET_VARIABLE action
    if (action.type === "SET_VARIABLE" && config.variableName) {
      const name = String(config.variableName);
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        variables.push({
          name,
          source: "SET_VARIABLE",
          actionId: action.id,
        });
      }
    }

    // LOOP action iterator variable
    if (action.type === "LOOP" && config.iteratorVariable) {
      const name = String(config.iteratorVariable);
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        variables.push({
          name,
          source: "LOOP_ITERATOR",
          actionId: action.id,
        });
      }
    }

    // GET_VARIABLE output variable (if specified and different)
    if (action.type === "GET_VARIABLE" && config.outputVariable) {
      const name = String(config.outputVariable);
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        variables.push({
          name,
          source: "GET_VARIABLE_OUTPUT",
          actionId: action.id,
        });
      }
    }
  }

  return variables;
}

/**
 * Get just the variable names from a workflow (simple string array).
 *
 * @param workflow - The workflow to scan
 * @returns Array of unique variable names
 */
export function getWorkflowVariableNames(
  workflow: Workflow | null | undefined
): string[] {
  return extractWorkflowVariables(workflow).map((v) => v.name);
}

/**
 * Merge global variables with workflow-local variables, removing duplicates.
 * Workflow variables take precedence (appear first) since they're more contextually relevant.
 *
 * @param globalVariables - Variable names from the global/project scope
 * @param workflowVariables - Variable names defined in the current workflow
 * @returns Merged array with workflow variables first, then global variables not already included
 */
export function mergeVariables(
  globalVariables: string[],
  workflowVariables: string[]
): string[] {
  const seen = new Set<string>(workflowVariables);
  const merged = [...workflowVariables];

  for (const name of globalVariables) {
    if (!seen.has(name)) {
      seen.add(name);
      merged.push(name);
    }
  }

  return merged;
}
