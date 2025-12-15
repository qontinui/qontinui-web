/**
 * Resource Analyzer Module
 *
 * Responsible for analyzing different resource types:
 * - Workflows
 * - States
 * - Images
 * - Transitions
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import { workflowComplexityAnalyzer } from "../workflow-complexity-analyzer";
import { WorkflowDependencyAnalyzer } from "../workflow-dependency-analyzer";
import { WorkflowDocumentationService } from "../workflow-documentation-service";
import { getWorkflowTestingService } from "../workflow-testing-service";
import type {
  WorkflowAnalysis,
  StateAnalysis,
  ImageAnalysis,
  TransitionAnalysis,
  BrokenReference,
} from "./types";
import { findDuplicateImages } from "./duplicate-detector";
import {
  findBrokenWorkflowReferences,
  findBrokenStateReferences,
} from "./reference-validator";

/**
 * Analyze all workflows
 */
export function analyzeWorkflows(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[]
): WorkflowAnalysis[] {
  const dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();
  const documentationService = WorkflowDocumentationService.getInstance();

  return workflows.map((workflow) => {
    const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);

    // Check testing
    const workflowTestingService = getWorkflowTestingService();
    const tests = workflowTestingService.getTestCasesForWorkflow(workflow.id);
    const hasTesting = tests.length > 0;

    // Check documentation
    const hasDocumentation = documentationService.hasDocumentation(workflow.id);

    // Check organization
    const isOrganized = !!(
      workflow.category && workflow.category !== "Uncategorized"
    );

    // Analyze dependencies
    const deps = dependencyAnalyzer.analyzeDependencies(workflow);
    const dependents = dependencyAnalyzer.getDependents(workflow.id, workflows);

    // Check if unused
    const isUnused =
      dependents.length === 0 && !workflow.metadata?.isEntryPoint;

    // Find broken references
    const brokenReferences = findBrokenWorkflowReferences(
      workflow,
      workflows,
      states,
      images
    );

    // Determine status
    let status: "healthy" | "warning" | "critical" = "healthy";
    const issues: string[] = [];

    if (brokenReferences.length > 0) {
      status = "critical";
      issues.push(`${brokenReferences.length} broken references`);
    }

    if (complexity.complexityScore > 75) {
      status = status === "critical" ? "critical" : "warning";
      issues.push("High complexity");
    }

    if (!hasTesting) {
      issues.push("No tests");
    }

    if (!hasDocumentation) {
      issues.push("No documentation");
    }

    return {
      workflowId: workflow.id,
      name: workflow.name,
      complexity,
      hasTesting,
      testCount: tests.length,
      hasDocumentation,
      isOrganized,
      folderPath: workflow.category,
      dependencyCount: deps.length,
      dependentCount: dependents.length,
      isUnused,
      brokenReferences,
      status,
      issues,
    };
  });
}

/**
 * Analyze all states
 */
export function analyzeStates(
  states: State[],
  transitions: Transition[],
  images: ImageAsset[]
): StateAnalysis[] {
  return states.map((state) => {
    // Count usage in transitions
    const usageCount = transitions.filter((t) => {
      if (t.type === "OutgoingTransition") {
        return (
          t.fromState === state.id ||
          t.toState === state.id ||
          t.activateStates.includes(state.id)
        );
      }
      return t.toState === state.id;
    }).length;

    const isUsed = usageCount > 0 || state.initial === true;

    // Find orphaned images (referenced but don't exist)
    const imageIds = new Set(images.map((img) => img.id));
    const orphanedImageIds = state.stateImages
      .flatMap((si) => si.patterns.map((p) => p.imageId))
      .filter((id): id is string => id !== undefined && !imageIds.has(id));

    // Calculate complexity
    const complexityScore = calculateStateComplexity(state);

    // Find broken references
    const brokenReferences = findBrokenStateReferences(state, images);

    // Determine status
    let status: "healthy" | "warning" | "critical" = "healthy";
    const issues: string[] = [];

    if (brokenReferences.length > 0) {
      status = "critical";
      issues.push(`${brokenReferences.length} broken references`);
    }

    if (!isUsed && !state.initial) {
      status = status === "critical" ? "critical" : "warning";
      issues.push("Unused state");
    }

    if (orphanedImageIds.length > 0) {
      status = status === "critical" ? "critical" : "warning";
      issues.push(`${orphanedImageIds.length} missing images`);
    }

    return {
      stateId: state.id,
      name: state.name,
      imageCount: state.stateImages.length,
      regionCount: state.regions.length,
      locationCount: state.locations.length,
      isUsed,
      usageCount,
      hasOrphanedImages: orphanedImageIds.length > 0,
      orphanedImageIds,
      complexityScore,
      brokenReferences,
      status,
      issues,
    };
  });
}

/**
 * Analyze all images
 */
export function analyzeImages(
  images: ImageAsset[],
  workflows: Workflow[],
  states: State[]
): ImageAnalysis[] {
  return images.map((image) => {
    // Find usage
    const usedIn: Array<{
      type: "state" | "workflow";
      id: string;
      name: string;
    }> = [];

    // Check states
    states.forEach((state) => {
      const usedInState = state.stateImages.some((si) =>
        si.patterns.some((p) => p.imageId === image.id)
      );
      if (usedInState) {
        usedIn.push({ type: "state", id: state.id, name: state.name });
      }
    });

    // Check workflows (actions with image configs)
    workflows.forEach((workflow) => {
      const usedInWorkflow = workflow.actions.some((action) => {
        const config = action.config as unknown;
        return config.target?.image === image.id || config.imageId === image.id;
      });
      if (usedInWorkflow) {
        usedIn.push({ type: "workflow", id: workflow.id, name: workflow.name });
      }
    });

    const isUsed = usedIn.length > 0;

    // Find duplicates
    const duplicates = findDuplicateImages(image, images, 0.95);

    // Calculate optimization potential
    const canOptimize = image.size > 500000; // > 500KB
    const potentialSavings = canOptimize ? Math.round(image.size * 0.3) : 0; // Assume 30% compression

    // Determine status
    let status: "healthy" | "warning" | "critical" = "healthy";
    const issues: string[] = [];

    if (!isUsed) {
      status = "warning";
      issues.push("Unused image");
    }

    if (duplicates.length > 0) {
      issues.push(`${duplicates.length} potential duplicates`);
    }

    if (canOptimize) {
      issues.push("Large file size - can be optimized");
    }

    return {
      imageId: image.id,
      name: image.name,
      size: image.size,
      isUsed,
      usageCount: usedIn.length,
      usedIn,
      duplicates,
      canOptimize,
      potentialSavings,
      status,
      issues,
    };
  });
}

/**
 * Analyze all transitions
 */
export function analyzeTransitions(
  transitions: Transition[],
  workflows: Workflow[],
  states: State[]
): TransitionAnalysis[] {
  const workflowIds = new Set(workflows.map((w) => w.id));
  const stateIds = new Set(states.map((s) => s.id));

  return transitions.map((transition) => {
    const brokenReferences: BrokenReference[] = [];

    // Check state references
    let hasValidStates = true;

    if (transition.type === "OutgoingTransition") {
      if (!stateIds.has(transition.fromState)) {
        hasValidStates = false;
        brokenReferences.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: transition.fromState,
          message: `From state "${transition.fromState}" does not exist`,
        });
      }

      if (transition.toState && !stateIds.has(transition.toState)) {
        hasValidStates = false;
        brokenReferences.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: transition.toState,
          message: `To state "${transition.toState}" does not exist`,
        });
      }

      transition.activateStates.forEach((stateId) => {
        if (!stateIds.has(stateId)) {
          hasValidStates = false;
          brokenReferences.push({
            type: "state",
            source: {
              type: "transition",
              id: transition.id,
              name: transition.id,
            },
            referencedId: stateId,
            message: `Activate state "${stateId}" does not exist`,
          });
        }
      });
    } else {
      if (!stateIds.has(transition.toState)) {
        hasValidStates = false;
        brokenReferences.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: transition.toState,
          message: `To state "${transition.toState}" does not exist`,
        });
      }
    }

    // Check workflow references
    let hasValidWorkflows = true;
    transition.workflows.forEach((workflowId) => {
      if (!workflowIds.has(workflowId)) {
        hasValidWorkflows = false;
        brokenReferences.push({
          type: "workflow",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: workflowId,
          message: `Workflow "${workflowId}" does not exist`,
        });
      }
    });

    // Check for circular dependencies
    const isCircular = isTransitionCircular(transition, transitions);

    // Determine status
    let status: "healthy" | "warning" | "critical" = "healthy";
    const issues: string[] = [];

    if (brokenReferences.length > 0) {
      status = "critical";
      issues.push(`${brokenReferences.length} broken references`);
    }

    if (isCircular) {
      issues.push("Part of circular dependency");
    }

    return {
      transitionId: transition.id,
      hasValidStates,
      hasValidWorkflows,
      brokenReferences,
      isCircular,
      status,
      issues,
    };
  });
}

/**
 * Calculate state complexity
 */
function calculateStateComplexity(state: State): number {
  // Simple complexity based on number of elements
  const imageCount = state.stateImages.length;
  const regionCount = state.regions.length;
  const locationCount = state.locations.length;
  const stringCount = state.strings.length;

  // Weighted sum
  const score =
    imageCount * 10 + regionCount * 5 + locationCount * 3 + stringCount * 2;

  // Normalize to 0-100
  return Math.min(100, score);
}

/**
 * Check if transition is circular
 */
function isTransitionCircular(
  transition: Transition,
  allTransitions: Transition[]
): boolean {
  if (transition.type !== "OutgoingTransition" || !transition.toState) {
    return false;
  }

  const visited = new Set<string>();
  const checkCircular = (fromState: string): boolean => {
    if (visited.has(fromState)) return false;
    visited.add(fromState);

    const outgoing = allTransitions.filter(
      (t) => t.type === "OutgoingTransition" && t.fromState === fromState
    ) as unknown[];

    for (const t of outgoing) {
      if (t.toState === transition.fromState) return true;
      if (t.toState && checkCircular(t.toState)) return true;
    }

    return false;
  };

  return checkCircular(transition.toState);
}
