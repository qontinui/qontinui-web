/**
 * Configuration Regenerator - Rebuilds configuration to pick up code changes
 *
 * This utility regenerates the entire configuration by processing it through
 * the current export code. This ensures any refactoring or schema changes
 * are picked up in the next export.
 */

import type { Workflow, State, Transition } from './action-schema/action-types';
import { createFindAnyStateImageWorkflow } from './workflow-helpers';

export interface RegenerationResult {
  success: boolean;
  message: string;
  details: {
    workflowsProcessed: number;
    transitionsProcessed: number;
    helperWorkflowsRegenerated: number;
    errors: string[];
  };
}

/**
 * Regenerate all helper workflows referenced in transitions.
 * This ensures they use the latest workflow generation code.
 */
export function regenerateHelperWorkflows(
  transitions: Transition[],
  states: State[]
): { regenerated: Map<string, Workflow>; count: number; errors: string[] } {
  const regenerated = new Map<string, Workflow>();
  const errors: string[] = [];
  let count = 0;

  // Build a map of state IDs to state objects for quick lookup
  const stateMap = new Map<string, State>();
  states.forEach(state => stateMap.set(state.id, state));

  // Process each transition
  transitions.forEach(transition => {
    // Check if this transition has inline workflows (helper workflows)
    const workflowRefs = transition.workflows || [];

    workflowRefs.forEach(ref => {
      if (ref.type === 'inline' && ref.workflow) {
        const inlineWorkflow = ref.workflow;

        // Check if this looks like a helper workflow (starts with wf-helper-)
        if (inlineWorkflow.id.startsWith('wf-helper-find-any-')) {
          // Extract the state this helper workflow is for
          // Helper workflows are tagged with the state ID
          const stateTags = inlineWorkflow.tags?.filter(tag =>
            !['helper', 'auto-generated', 'find-state-image'].includes(tag)
          ) || [];

          if (stateTags.length > 0) {
            const stateId = stateTags[0];
            const state = stateMap.get(stateId);

            if (state) {
              try {
                // Regenerate the helper workflow using current code
                const newWorkflow = createFindAnyStateImageWorkflow(state);

                // Preserve the original ID so references don't break
                newWorkflow.id = inlineWorkflow.id;

                regenerated.set(inlineWorkflow.id, newWorkflow);
                count++;
              } catch (error) {
                errors.push(`Failed to regenerate helper workflow ${inlineWorkflow.id}: ${error}`);
              }
            } else {
              errors.push(`State ${stateId} not found for helper workflow ${inlineWorkflow.id}`);
            }
          }
        }
      }
    });
  });

  return { regenerated, count, errors };
}

/**
 * Process workflows through current export logic.
 * This ensures they match the latest schema and code structure.
 */
export function processWorkflowsThroughExportLogic(workflows: Workflow[]): {
  processed: Workflow[];
  errors: string[];
} {
  const processed: Workflow[] = [];
  const errors: string[] = [];

  workflows.forEach(workflow => {
    try {
      // Deep clone to avoid modifying original
      const processedWorkflow = JSON.parse(JSON.stringify(workflow));

      // Ensure format is correct
      if (!processedWorkflow.format) {
        processedWorkflow.format = 'graph';
      }

      // Ensure connections exist
      if (!processedWorkflow.connections) {
        processedWorkflow.connections = {};
      }

      // Update metadata timestamps
      if (!processedWorkflow.metadata) {
        processedWorkflow.metadata = {};
      }
      processedWorkflow.metadata.updatedAt = new Date().toISOString();

      processed.push(processedWorkflow);
    } catch (error) {
      errors.push(`Failed to process workflow ${workflow.id}: ${error}`);
    }
  });

  return { processed, errors };
}

/**
 * Update transitions with regenerated helper workflows.
 */
export function updateTransitionsWithRegeneratedWorkflows(
  transitions: Transition[],
  regeneratedWorkflows: Map<string, Workflow>
): Transition[] {
  return transitions.map(transition => {
    const updatedWorkflowRefs = (transition.workflows || []).map(ref => {
      if (ref.type === 'inline' && ref.workflow) {
        const regenerated = regeneratedWorkflows.get(ref.workflow.id);
        if (regenerated) {
          return {
            ...ref,
            workflow: regenerated
          };
        }
      }
      return ref;
    });

    return {
      ...transition,
      workflows: updatedWorkflowRefs
    };
  });
}

/**
 * Main regeneration function - rebuilds entire configuration.
 *
 * This function:
 * 1. Processes all workflows through current export logic
 * 2. Regenerates all helper workflows with current code
 * 3. Updates transitions with regenerated workflows
 *
 * @returns Result object with success status and details
 */
export async function regenerateConfiguration(
  workflows: Workflow[],
  transitions: Transition[],
  states: State[]
): Promise<{
  workflows: Workflow[];
  transitions: Transition[];
  result: RegenerationResult;
}> {
  const allErrors: string[] = [];

  try {
    // Step 1: Process workflows through export logic
    const { processed: processedWorkflows, errors: workflowErrors } =
      processWorkflowsThroughExportLogic(workflows);
    allErrors.push(...workflowErrors);

    // Step 2: Regenerate helper workflows
    const { regenerated, count: helperCount, errors: helperErrors } =
      regenerateHelperWorkflows(transitions, states);
    allErrors.push(...helperErrors);

    // Step 3: Update transitions with regenerated workflows
    const updatedTransitions = updateTransitionsWithRegeneratedWorkflows(
      transitions,
      regenerated
    );

    const result: RegenerationResult = {
      success: allErrors.length === 0,
      message: allErrors.length === 0
        ? 'Configuration regenerated successfully'
        : `Configuration regenerated with ${allErrors.length} error(s)`,
      details: {
        workflowsProcessed: processedWorkflows.length,
        transitionsProcessed: updatedTransitions.length,
        helperWorkflowsRegenerated: helperCount,
        errors: allErrors
      }
    };

    return {
      workflows: processedWorkflows,
      transitions: updatedTransitions,
      result
    };
  } catch (error) {
    return {
      workflows,
      transitions,
      result: {
        success: false,
        message: `Fatal error during regeneration: ${error}`,
        details: {
          workflowsProcessed: 0,
          transitionsProcessed: 0,
          helperWorkflowsRegenerated: 0,
          errors: [...allErrors, String(error)]
        }
      }
    };
  }
}
