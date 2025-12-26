/**
 * Reference Cleaner Module
 *
 * Responsible for cleaning up broken/orphaned references:
 * - Workflow connections that reference non-existent action IDs
 * - Transition workflows that reference non-existent workflow IDs
 */

import type { Workflow, Connections } from "@/lib/action-schema/action-types";
import type { Transition } from "@/contexts/automation-context/types";

export interface CleanupResult {
  /** Number of workflow connection entries cleaned */
  workflowConnectionsCleaned: number;

  /** Number of transition workflow references cleaned */
  transitionWorkflowsCleaned: number;

  /** Details of what was cleaned */
  details: CleanupDetail[];
}

export interface CleanupDetail {
  type: "workflow-connection" | "transition-workflow";
  sourceId: string;
  sourceName?: string;
  removedId: string;
  reason: string;
}

/**
 * Clean orphaned workflow connections that reference non-existent action IDs
 */
export function cleanWorkflowConnections(workflow: Workflow): {
  workflow: Workflow;
  cleaned: CleanupDetail[];
} {
  const actionIds = new Set(workflow.actions.map((a) => a.id));
  const cleaned: CleanupDetail[] = [];

  // Create a new connections object with only valid references
  const newConnections: Connections = {};

  Object.entries(workflow.connections).forEach(([sourceActionId, outputs]) => {
    // Check if source action exists
    if (!actionIds.has(sourceActionId)) {
      cleaned.push({
        type: "workflow-connection",
        sourceId: workflow.id,
        sourceName: workflow.name,
        removedId: sourceActionId,
        reason: `Source action "${sourceActionId}" does not exist`,
      });
      return; // Skip this entire connection entry
    }

    // Filter target connections to only include existing actions
    const cleanedOutputs: typeof outputs = {};
    let hasValidOutputs = false;

    if (outputs.main) {
      const cleanedMain = outputs.main.map((branch) =>
        branch.filter((conn) => {
          if (!actionIds.has(conn.action)) {
            cleaned.push({
              type: "workflow-connection",
              sourceId: workflow.id,
              sourceName: workflow.name,
              removedId: conn.action,
              reason: `Target action "${conn.action}" does not exist (from ${sourceActionId} main)`,
            });
            return false;
          }
          return true;
        })
      );
      // Only include non-empty branches
      const nonEmptyMain = cleanedMain.filter((branch) => branch.length > 0);
      if (nonEmptyMain.length > 0) {
        cleanedOutputs.main = nonEmptyMain;
        hasValidOutputs = true;
      }
    }

    if (outputs.success) {
      const cleanedSuccess = outputs.success.map((branch) =>
        branch.filter((conn) => {
          if (!actionIds.has(conn.action)) {
            cleaned.push({
              type: "workflow-connection",
              sourceId: workflow.id,
              sourceName: workflow.name,
              removedId: conn.action,
              reason: `Target action "${conn.action}" does not exist (from ${sourceActionId} success)`,
            });
            return false;
          }
          return true;
        })
      );
      const nonEmptySuccess = cleanedSuccess.filter(
        (branch) => branch.length > 0
      );
      if (nonEmptySuccess.length > 0) {
        cleanedOutputs.success = nonEmptySuccess;
        hasValidOutputs = true;
      }
    }

    if (outputs.error) {
      const cleanedError = outputs.error.map((branch) =>
        branch.filter((conn) => {
          if (!actionIds.has(conn.action)) {
            cleaned.push({
              type: "workflow-connection",
              sourceId: workflow.id,
              sourceName: workflow.name,
              removedId: conn.action,
              reason: `Target action "${conn.action}" does not exist (from ${sourceActionId} error)`,
            });
            return false;
          }
          return true;
        })
      );
      const nonEmptyError = cleanedError.filter((branch) => branch.length > 0);
      if (nonEmptyError.length > 0) {
        cleanedOutputs.error = nonEmptyError;
        hasValidOutputs = true;
      }
    }

    if (hasValidOutputs) {
      newConnections[sourceActionId] = cleanedOutputs;
    }
  });

  return {
    workflow: {
      ...workflow,
      connections: newConnections,
    },
    cleaned,
  };
}

/**
 * Clean orphaned workflow references from a transition
 */
export function cleanTransitionWorkflows(
  transition: Transition,
  workflowIds: Set<string>
): {
  transition: Transition;
  cleaned: CleanupDetail[];
} {
  const cleaned: CleanupDetail[] = [];

  const validWorkflows = transition.workflows.filter((workflowId) => {
    if (!workflowIds.has(workflowId)) {
      cleaned.push({
        type: "transition-workflow",
        sourceId: transition.id,
        removedId: workflowId,
        reason: `Workflow "${workflowId}" does not exist`,
      });
      return false;
    }
    return true;
  });

  return {
    transition: {
      ...transition,
      workflows: validWorkflows,
    },
    cleaned,
  };
}

/**
 * Clean all broken references in the project
 */
export function cleanAllReferences(
  workflows: Workflow[],
  transitions: Transition[]
): {
  workflows: Workflow[];
  transitions: Transition[];
  result: CleanupResult;
} {
  const result: CleanupResult = {
    workflowConnectionsCleaned: 0,
    transitionWorkflowsCleaned: 0,
    details: [],
  };

  // Clean workflow connections
  const cleanedWorkflows = workflows.map((workflow) => {
    const { workflow: cleanedWorkflow, cleaned } =
      cleanWorkflowConnections(workflow);
    result.workflowConnectionsCleaned += cleaned.length;
    result.details.push(...cleaned);
    return cleanedWorkflow;
  });

  // Create set of valid workflow IDs
  const workflowIds = new Set(cleanedWorkflows.map((w) => w.id));

  // Clean transition workflow references
  const cleanedTransitions = transitions.map((transition) => {
    const { transition: cleanedTransition, cleaned } = cleanTransitionWorkflows(
      transition,
      workflowIds
    );
    result.transitionWorkflowsCleaned += cleaned.length;
    result.details.push(...cleaned);
    return cleanedTransition;
  });

  return {
    workflows: cleanedWorkflows,
    transitions: cleanedTransitions,
    result,
  };
}
