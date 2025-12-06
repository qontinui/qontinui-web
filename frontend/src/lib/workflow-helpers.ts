/**
 * Workflow Helpers - Generate common helper workflows for transitions
 */

import type { Workflow, Action } from "./action-schema/action-types";
import type { State } from "@/contexts/automation-context";

/**
 * Generate a unique ID for workflows/actions
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a helper workflow that finds any state image in the given state.
 * This workflow tries to find each state image in sequence using IF + EXISTS checks.
 * If any image is found, the workflow succeeds and returns true.
 *
 * @param state - The state whose images should be searched for
 * @returns A workflow configured to find any state image
 */
export function createFindAnyStateImageWorkflow(state: State): Workflow {
  const workflowId = generateId("wf-helper-find-any");
  const stateImages = state.stateImages || [];

  if (stateImages.length === 0) {
    // If no state images, create a simple workflow that immediately succeeds
    const action: Action = {
      id: generateId("action"),
      type: "WAIT",
      config: { waitFor: "time", duration: 1 },
      position: [250, 100],
    };

    return {
      id: workflowId,
      name: `Find Any Image: ${state.name}`,
      version: "1.0.0",
      format: "graph",
      category: "Transitions",
      description: `Helper workflow to check if any state image from "${state.name}" is visible. Auto-generated helper workflow.`,
      actions: [action],
      connections: {},
      metadata: {
        viewMode: "sequential",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tags: ["helper", "auto-generated", "find-state-image"],
    };
  }

  // Create actions and connections for each state image
  const actions: Action[] = [];
  // Pydantic schema format: {action_id: {type: [[{action, type, index}]]}}
  const connections: Record<
    string,
    Record<
      string,
      Array<Array<{ action: string; type: string; index: number }>>
    >
  > = {};

  // Starting position for layout
  let xPos = 100;
  const yPos = 100;
  const xSpacing = 300;

  // Create a chain of IF actions that check for each image
  stateImages.forEach((stateImage, index) => {
    const ifActionId = generateId(`if-${index}`);

    // Create IF action that checks if this state image exists
    const ifAction: Action<"IF"> = {
      id: ifActionId,
      type: "IF",
      config: {
        condition: {
          type: "image_exists",
          imageId: stateImage.id,
        },
        thenActions: [], // Success - workflow ends here
        elseActions: [], // Continue to next check
      },
      position: [xPos, yPos],
    };

    actions.push(ifAction);

    // Connect to previous action (if not first)
    if (index > 0) {
      const prevAction = actions[index - 1];
      if (prevAction) {
        const prevActionId = prevAction.id;
        // Connect through the 'false' branch (else path) of previous IF
        if (!connections[prevActionId]) {
          connections[prevActionId] = {};
        }
        const prevConn = connections[prevActionId];
        if (prevConn) {
          prevConn["false"] = [
            [
              {
                action: ifActionId,
                type: "false",
                index: 0,
              },
            ],
          ];
        }
      }
    }

    xPos += xSpacing;
  });

  // Add a final action that executes if no images were found
  // This could be a simple LOG or RETURN action
  const finalActionId = generateId("final");
  const finalAction: Action = {
    id: finalActionId,
    type: "WAIT",
    config: { waitFor: "time", duration: 1 },
    position: [xPos, yPos],
  };
  actions.push(finalAction);

  // Connect last IF's false branch to final action
  if (actions.length > 1) {
    const lastIf = actions[actions.length - 2];
    if (lastIf) {
      if (!connections[lastIf.id]) {
        connections[lastIf.id] = {};
      }
      const lastConn = connections[lastIf.id];
      if (lastConn) {
        lastConn["false"] = [
          [
            {
              action: finalActionId,
              type: "false",
              index: 0,
            },
          ],
        ];
      }
    }
  }

  return {
    id: workflowId,
    name: `Find Any Image: ${state.name}`,
    version: "1.0.0",
    format: "graph",
    category: "Transitions",
    description: `Helper workflow to check if any of the ${stateImages.length} state image(s) from "${state.name}" is visible on screen. Returns true when any image is found. Auto-generated helper workflow.`,
    actions,
    connections,
    metadata: {
      viewMode: "sequential",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    tags: ["helper", "auto-generated", "find-state-image", state.id],
  };
}
