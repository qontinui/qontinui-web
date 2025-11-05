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

  // Find all helper workflows in the workflows array (by ID pattern)
  const helperWorkflows = workflows.filter(w => w.id.startsWith('wf-helper-find-any-'));

  helperWorkflows.forEach(helperWorkflow => {
    if (helperWorkflow) {
      // Check if this looks like a helper workflow (starts with wf-helper-)
      if (helperWorkflow.id.startsWith('wf-helper-find-any-')) {
          // Extract the state this helper workflow is for
          // Helper workflows are tagged with the state ID
          const stateTags = helperWorkflow.tags?.filter(tag =>
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
                newWorkflow.id = helperWorkflow.id;

                regenerated.set(helperWorkflow.id, newWorkflow);
                count++;
              } catch (error) {
                errors.push(`Failed to regenerate helper workflow ${helperWorkflow.id}: ${error}`);
              }
            } else {
              errors.push(`State ${stateId} not found for helper workflow ${helperWorkflow.id}`);
            }
          }
        }
      }
    });

  return { regenerated, count, errors };
}

/**
 * Update action configs to use the new schema format.
 * - FIND actions: Converts {imageId: '...'} to {target: {type: 'image', imageId: '...'}}
 * - MOUSE_MOVE actions: Converts "Last Find Result" string to {type: 'lastFindResult'}
 * - CLICK actions:
 *   - Converts "Current Position" string to {type: 'currentPosition'}
 *   - Migrates clickType -> mouseButton (lowercase to uppercase)
 *   - Migrates clickCount -> numberOfClicks
 */
function updateActionConfigs(actions: any[]): number {
  let updatedCount = 0;

  actions.forEach(action => {
    // Update FIND actions
    if (action.type === 'FIND' && action.config) {
      // Check if using old schema (has imageId but no target)
      if (action.config.imageId && !action.config.target) {
        const oldImageId = action.config.imageId;

        // Convert to new schema
        action.config.target = {
          type: 'image',
          imageId: oldImageId
        };

        // Remove old imageId field
        delete action.config.imageId;

        updatedCount++;
      }
    }

    // Update MOUSE_MOVE actions with "Last Find Result" string target
    if (action.type === 'MOUSE_MOVE' && action.config) {
      if (typeof action.config.target === 'string' && action.config.target === 'Last Find Result') {
        // Convert to LastFindResultTarget
        action.config.target = {
          type: 'lastFindResult'
        };
        updatedCount++;
      }
    }

    // Update CLICK actions with "Current Position" string target
    if (action.type === 'CLICK' && action.config) {
      if (typeof action.config.target === 'string' && action.config.target === 'Current Position') {
        // Convert to CurrentPositionTarget
        action.config.target = {
          type: 'currentPosition'
        };
        updatedCount++;
      }

      // Migrate old field names to new schema (clickType -> mouseButton, clickCount -> numberOfClicks)
      if (action.config.clickType !== undefined) {
        // Convert clickType ('left', 'right', 'middle') to mouseButton ('LEFT', 'RIGHT', 'MIDDLE')
        const clickTypeMap: Record<string, string> = {
          'left': 'LEFT',
          'right': 'RIGHT',
          'middle': 'MIDDLE',
          'double': 'LEFT' // double-click is LEFT button with numberOfClicks=2
        };
        action.config.mouseButton = clickTypeMap[action.config.clickType.toLowerCase()] || 'LEFT';

        // Handle double-click: convert to numberOfClicks=2
        if (action.config.clickType.toLowerCase() === 'double' && !action.config.numberOfClicks) {
          action.config.numberOfClicks = 2;
        }

        delete action.config.clickType;
        updatedCount++;
      }

      if (action.config.clickCount !== undefined) {
        action.config.numberOfClicks = action.config.clickCount;
        delete action.config.clickCount;
        updatedCount++;
      }
    }
  });

  return updatedCount;
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
  let totalFindActionsUpdated = 0;

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

      // Update action configs to new schema (FIND and MOUSE_MOVE)
      if (processedWorkflow.actions && Array.isArray(processedWorkflow.actions)) {
        const updatedCount = updateActionConfigs(processedWorkflow.actions);
        totalFindActionsUpdated += updatedCount;

        if (updatedCount > 0) {
          console.log(`Regenerate: Updated ${updatedCount} action(s) in workflow '${processedWorkflow.name || processedWorkflow.id}'`);
        }
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

  if (totalFindActionsUpdated > 0) {
    console.log(`Regenerate: Total FIND actions updated: ${totalFindActionsUpdated}`);
  }

  return { processed, errors };
}

/**
 * Update transitions with regenerated helper workflows.
 */
export function updateWorkflowsWithRegenerated(
  workflows: Workflow[],
  regeneratedWorkflows: Map<string, Workflow>
): Workflow[] {
  return workflows.map(workflow => {
    // If this workflow was regenerated, use the new version
    const regenerated = regeneratedWorkflows.get(workflow.id);
    return regenerated || workflow;
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
