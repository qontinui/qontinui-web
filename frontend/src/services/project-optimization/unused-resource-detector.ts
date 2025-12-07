/**
 * Unused Resource Detector Module
 *
 * Responsible for detecting orphaned and unused resources:
 * - Unused images
 * - Unused states
 * - Unused workflows
 * - Orphaned states
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import { WorkflowDependencyAnalyzer } from "../workflow-dependency-analyzer";
import { analyzeImages, analyzeStates } from "./resource-analyzer";

/**
 * Find unused images
 */
export function findUnusedImages(
  images: ImageAsset[],
  workflows: Workflow[],
  states: State[]
): string[] {
  const analyses = analyzeImages(images, workflows, states);
  return analyses.filter((a) => !a.isUsed).map((a) => a.imageId);
}

/**
 * Find unused states
 */
export function findUnusedStates(
  states: State[],
  transitions: Transition[]
): string[] {
  const analyses = analyzeStates(states, transitions, []);
  return analyses.filter((a) => !a.isUsed).map((a) => a.stateId);
}

/**
 * Find unused workflows
 */
export function findUnusedWorkflows(workflows: Workflow[]): string[] {
  const dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();
  return dependencyAnalyzer.findUnusedWorkflows(workflows);
}

/**
 * Find orphaned states (no transitions)
 */
export function findOrphanedStates(
  states: State[],
  transitions: Transition[]
): string[] {
  const statesInTransitions = new Set<string>();

  transitions.forEach((t) => {
    if (t.type === "OutgoingTransition") {
      statesInTransitions.add(t.fromState);
      if (t.toState) statesInTransitions.add(t.toState);
      t.activateStates.forEach((id) => statesInTransitions.add(id));
    } else {
      statesInTransitions.add(t.toState);
    }
  });

  return states
    .filter((s) => !statesInTransitions.has(s.id) && !s.initial)
    .map((s) => s.id);
}
