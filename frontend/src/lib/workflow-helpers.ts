/**
 * Workflow Helpers - Generate common helper workflows for transitions
 */

import type { Workflow, Action } from "./action-schema/action-types";
import type { State, StateImage } from "@/contexts/automation-context";

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
      category: "Incoming Transitions",
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
    category: "Incoming Transitions",
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

/**
 * Create a workflow that clicks on a StateImage.
 * This is used for simple outgoing transitions where clicking an image
 * triggers navigation to another state.
 *
 * @param sourceState - The state containing the StateImage
 * @param stateImage - The StateImage to click on
 * @returns A workflow configured to click on the StateImage
 */
export function createClickStateImageWorkflow(
  sourceState: State,
  stateImage: StateImage
): Workflow {
  const workflowId = generateId("wf-click");

  // Create a FIND action first to locate the specific StateImage
  const findActionId = generateId("find");
  const findAction: Action<"FIND"> = {
    id: findActionId,
    type: "FIND",
    name: `Find ${stateImage.name}`,
    config: {
      // Use target.type: "image" with imageIds array to find specific StateImage(s)
      // (target.type: "stateImage" would find ANY image from the state)
      target: {
        type: "image",
        imageIds: [stateImage.id],
      },
    },
    position: [150, 100],
  };

  // Create a CLICK action that clicks on the found image
  const clickActionId = generateId("click");
  const clickAction: Action<"CLICK"> = {
    id: clickActionId,
    type: "CLICK",
    name: `Click ${stateImage.name}`,
    config: {
      target: "Last Find Result",
      mouseButton: "LEFT",
      numberOfClicks: 1,
    },
    position: [150, 250],
  };

  // Connect FIND to CLICK
  const connections = {
    [findActionId]: {
      main: [[{ action: clickActionId, type: "main" as const, index: 0 }]],
    },
  };

  return {
    id: workflowId,
    name: `Click: ${stateImage.name}`,
    version: "1.0.0",
    format: "graph",
    category: "Outgoing Transitions",
    description: `Clicks on "${stateImage.name}" in state "${sourceState.name}". Auto-generated outgoing transition workflow.`,
    actions: [findAction, clickAction],
    connections,
    metadata: {
      viewMode: "sequential",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    tags: ["helper", "auto-generated", "click-state-image", sourceState.id],
  };
}

/**
 * Create a workflow that finds any state image in the target state.
 * This is the default incoming transition workflow - it verifies
 * that the target state is visible by finding any of its images.
 *
 * @param targetState - The state to verify is visible
 * @returns A workflow that finds any image from the target state
 */
export function createFindStateWorkflow(targetState: State): Workflow {
  const workflowId = generateId("wf-find-state");
  const stateImages = targetState.stateImages || [];

  if (stateImages.length === 0) {
    // If no state images, create a simple workflow that immediately succeeds
    const action: Action = {
      id: generateId("action"),
      type: "WAIT",
      config: { waitFor: "time", duration: 100 },
      position: [250, 100],
    };

    return {
      id: workflowId,
      name: `Find State: ${targetState.name}`,
      version: "1.0.0",
      format: "graph",
      category: "Incoming Transitions",
      description: `Verifies that state "${targetState.name}" is visible. No images to check.`,
      actions: [action],
      connections: {},
      metadata: {
        viewMode: "sequential",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
      tags: ["helper", "auto-generated", "find-state", targetState.id],
    };
  }

  // Create a single FIND action that searches for any state image
  const findActionId = generateId("find");
  const findAction: Action<"FIND"> = {
    id: findActionId,
    type: "FIND",
    name: `Find any image in ${targetState.name}`,
    config: {
      target: {
        type: "stateImage",
        stateId: targetState.id,
        imageIds: stateImages.map((img) => img.id),
      },
    },
    position: [150, 100],
  };

  return {
    id: workflowId,
    name: `Find State: ${targetState.name}`,
    version: "1.0.0",
    format: "graph",
    category: "Incoming Transitions",
    description: `Verifies that state "${targetState.name}" is visible by finding any of its ${stateImages.length} image(s). Auto-generated incoming transition workflow.`,
    actions: [findAction],
    connections: {},
    metadata: {
      viewMode: "sequential",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    tags: ["helper", "auto-generated", "find-state", targetState.id],
  };
}
