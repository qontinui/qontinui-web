/**
 * Reference Validator Module
 *
 * Responsible for validating references between resources:
 * - Workflow references
 * - State references
 * - Transition references
 * - Image references
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import type { BrokenReference } from "./types";

/**
 * Validate all references in the project
 */
export function validateAllReferences(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): BrokenReference[] {
  const broken: BrokenReference[] = [];

  workflows.forEach((workflow) => {
    broken.push(
      ...findBrokenWorkflowReferences(workflow, workflows, states, images)
    );
  });

  states.forEach((state) => {
    broken.push(...findBrokenStateReferences(state, images));
  });

  transitions.forEach((transition) => {
    broken.push(
      ...findBrokenTransitionReferences(transition, workflows, states)
    );
  });

  return broken;
}

/**
 * Find broken references in a workflow
 */
export function findBrokenWorkflowReferences(
  workflow: Workflow,
  allWorkflows: Workflow[],
  states: State[],
  images: ImageAsset[]
): BrokenReference[] {
  const broken: BrokenReference[] = [];
  const workflowIds = new Set(allWorkflows.map((w) => w.id));
  const stateIds = new Set(states.map((s) => s.id));
  const imageIds = new Set(images.map((i) => i.id));

  workflow.actions.forEach((action) => {
    // Check RUN_WORKFLOW actions
    if (action.type === "RUN_WORKFLOW") {
      const config = action.config as { workflowId?: string };
      if (config.workflowId && !workflowIds.has(config.workflowId)) {
        broken.push({
          type: "workflow",
          source: { type: "workflow", id: workflow.id, name: workflow.name },
          referencedId: config.workflowId,
          location: action.id,
          message: `Action "${action.name || action.id}" references missing workflow "${config.workflowId}"`,
        });
      }
    }

    // Check GO_TO_STATE actions
    if (action.type === "GO_TO_STATE") {
      const config = action.config as { stateId?: string };
      if (config.stateId && !stateIds.has(config.stateId)) {
        broken.push({
          type: "state",
          source: { type: "workflow", id: workflow.id, name: workflow.name },
          referencedId: config.stateId,
          location: action.id,
          message: `Action "${action.name || action.id}" references missing state "${config.stateId}"`,
        });
      }
    }

    // Check image references in action configs
    const config = action.config as { target?: { image?: string }; imageId?: string };
    if (config.target?.image && !imageIds.has(config.target.image)) {
      broken.push({
        type: "image",
        source: { type: "workflow", id: workflow.id, name: workflow.name },
        referencedId: config.target.image,
        location: action.id,
        message: `Action "${action.name || action.id}" references missing image "${config.target.image}"`,
      });
    }

    if (config.imageId && !imageIds.has(config.imageId)) {
      broken.push({
        type: "image",
        source: { type: "workflow", id: workflow.id, name: workflow.name },
        referencedId: config.imageId,
        location: action.id,
        message: `Action "${action.name || action.id}" references missing image "${config.imageId}"`,
      });
    }
  });

  return broken;
}

/**
 * Find broken references in a state
 */
export function findBrokenStateReferences(
  state: State,
  images: ImageAsset[]
): BrokenReference[] {
  const broken: BrokenReference[] = [];
  const imageIds = new Set(images.map((i) => i.id));

  state.stateImages.forEach((stateImage) => {
    stateImage.patterns.forEach((pattern) => {
      if (pattern.imageId && !imageIds.has(pattern.imageId)) {
        broken.push({
          type: "image",
          source: { type: "state", id: state.id, name: state.name },
          referencedId: pattern.imageId,
          location: stateImage.id,
          message: `State image "${stateImage.name}" pattern references missing image "${pattern.imageId}"`,
        });
      }
    });
  });

  return broken;
}

/**
 * Find broken references in a transition
 */
export function findBrokenTransitionReferences(
  transition: Transition,
  workflows: Workflow[],
  states: State[]
): BrokenReference[] {
  const broken: BrokenReference[] = [];
  const workflowIds = new Set(workflows.map((w) => w.id));
  const stateIds = new Set(states.map((s) => s.id));

  // Check workflow references
  transition.workflows.forEach((workflowId) => {
    if (!workflowIds.has(workflowId)) {
      broken.push({
        type: "workflow",
        source: { type: "transition", id: transition.id, name: transition.id },
        referencedId: workflowId,
        message: `Transition references missing workflow "${workflowId}"`,
      });
    }
  });

  // Check state references
  if (transition.type === "OutgoingTransition") {
    if (!stateIds.has(transition.fromState)) {
      broken.push({
        type: "state",
        source: { type: "transition", id: transition.id, name: transition.id },
        referencedId: transition.fromState,
        message: `Transition references missing from state "${transition.fromState}"`,
      });
    }

    if (transition.toState && !stateIds.has(transition.toState)) {
      broken.push({
        type: "state",
        source: { type: "transition", id: transition.id, name: transition.id },
        referencedId: transition.toState,
        message: `Transition references missing to state "${transition.toState}"`,
      });
    }

    transition.activateStates.forEach((stateId) => {
      if (!stateIds.has(stateId)) {
        broken.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: stateId,
          message: `Transition references missing activate state "${stateId}"`,
        });
      }
    });
  } else {
    if (!stateIds.has(transition.toState)) {
      broken.push({
        type: "state",
        source: { type: "transition", id: transition.id, name: transition.id },
        referencedId: transition.toState,
        message: `Transition references missing to state "${transition.toState}"`,
      });
    }
  }

  return broken;
}
