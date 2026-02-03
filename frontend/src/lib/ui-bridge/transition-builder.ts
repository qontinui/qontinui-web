/**
 * Transition Builder for UI Bridge Exploration
 *
 * Builds suggested state machine transitions from exploration step data.
 * This enables automatic discovery of state transitions from UI exploration results.
 */

import type {
  UIBridgeExplorationStep,
  UIBridgeDiscoveredState,
  SuggestedTransition,
  TransitionBuildResult,
} from "@/hooks/useUIBridgeExploration";

/**
 * Internal type for grouping transitions during building
 */
interface TransitionGroup {
  fromStateHash: string;
  toStateHash: string;
  triggerElementId: string;
  triggerAction: string;
  stepIds: string[];
  newElements: Set<string>;
  removedElements: Set<string>;
}

/**
 * Build suggested transitions from exploration steps.
 *
 * This function analyzes the sequence of exploration steps to identify
 * state transitions based on:
 * 1. Steps where state_changed === true
 * 2. Snapshot hash changes (before vs after)
 * 3. Element appearance/disappearance patterns
 *
 * @param steps - Array of exploration steps from UI Bridge exploration
 * @param discoveredStates - Optional array of discovered states for naming
 * @returns TransitionBuildResult with suggested transitions and metadata
 */
export function buildTransitionsFromSteps(
  steps: UIBridgeExplorationStep[],
  discoveredStates?: UIBridgeDiscoveredState[]
): TransitionBuildResult {
  const transitions: SuggestedTransition[] = [];
  const stateHashes = new Map<string, string[]>();
  const unmappedSteps: UIBridgeExplorationStep[] = [];
  const transitionGroups = new Map<string, TransitionGroup>();

  // Build state hash -> element IDs mapping from snapshots
  for (const step of steps) {
    if (step.snapshot_before_hash && step.elements_before) {
      if (!stateHashes.has(step.snapshot_before_hash)) {
        stateHashes.set(step.snapshot_before_hash, step.elements_before);
      }
    }
    if (step.snapshot_after_hash && step.elements_after) {
      if (!stateHashes.has(step.snapshot_after_hash)) {
        stateHashes.set(step.snapshot_after_hash, step.elements_after);
      }
    }
  }

  // Filter and process steps that caused state changes
  for (const step of steps) {
    // Skip steps without enhanced data
    if (!step.snapshot_before_hash || !step.snapshot_after_hash) {
      // If step has state_changed but no hashes, mark as unmapped
      if (step.state_changed) {
        unmappedSteps.push(step);
      }
      continue;
    }

    // Skip steps where state didn't change (same hash before and after)
    if (step.snapshot_before_hash === step.snapshot_after_hash) {
      continue;
    }

    // Skip steps without state_changed flag (unless they have different hashes)
    // This allows us to catch transitions even if state_changed wasn't set
    if (
      !step.state_changed &&
      !step.action_result?.new_elements?.length &&
      !step.action_result?.removed_elements?.length
    ) {
      continue;
    }

    // Create a unique key for this transition type
    const groupKey = `${step.snapshot_before_hash}|${step.snapshot_after_hash}|${step.element_id}|${step.action}`;

    let group = transitionGroups.get(groupKey);
    if (!group) {
      group = {
        fromStateHash: step.snapshot_before_hash,
        toStateHash: step.snapshot_after_hash,
        triggerElementId: step.element_id,
        triggerAction: step.action,
        stepIds: [],
        newElements: new Set<string>(),
        removedElements: new Set<string>(),
      };
      transitionGroups.set(groupKey, group);
    }

    // Add this step to the group
    group.stepIds.push(step.step_id);

    // Accumulate element changes
    if (step.action_result?.new_elements) {
      for (const el of step.action_result.new_elements) {
        group.newElements.add(el);
      }
    }
    if (step.action_result?.removed_elements) {
      for (const el of step.action_result.removed_elements) {
        group.removedElements.add(el);
      }
    }
  }

  // Convert groups to transitions with confidence scores
  const maxOccurrences = Math.max(
    1,
    ...Array.from(transitionGroups.values()).map((g) => g.stepIds.length)
  );

  for (const [, group] of transitionGroups) {
    // Calculate confidence based on occurrence count and data completeness
    const occurrenceConfidence = group.stepIds.length / maxOccurrences;
    const hasElementChanges =
      group.newElements.size > 0 || group.removedElements.size > 0;
    const dataConfidence = hasElementChanges ? 1.0 : 0.7;
    const confidence = Math.min(1.0, occurrenceConfidence * dataConfidence);

    // Find state names from discovered states if available
    const fromStateName = findStateName(
      group.fromStateHash,
      stateHashes,
      discoveredStates
    );
    const toStateName = findStateName(
      group.toStateHash,
      stateHashes,
      discoveredStates
    );

    transitions.push({
      id: `transition_${group.fromStateHash}_${group.toStateHash}_${group.triggerElementId}`,
      fromStateHash: group.fromStateHash,
      toStateHash: group.toStateHash,
      triggerElementId: group.triggerElementId,
      triggerAction: group.triggerAction,
      activateElements: Array.from(group.newElements),
      deactivateElements: Array.from(group.removedElements),
      confidence,
      stepIds: group.stepIds,
      fromStateName,
      toStateName,
    });
  }

  // Sort transitions by confidence (highest first)
  transitions.sort((a, b) => b.confidence - a.confidence);

  return {
    transitions,
    stateHashes,
    unmappedSteps,
  };
}

/**
 * Find a human-readable state name from discovered states.
 *
 * Matches states based on element overlap between the state hash's
 * elements and the discovered state's elements.
 */
function findStateName(
  stateHash: string,
  stateHashes: Map<string, string[]>,
  discoveredStates?: UIBridgeDiscoveredState[]
): string | undefined {
  if (!discoveredStates || discoveredStates.length === 0) {
    return undefined;
  }

  const stateElements = stateHashes.get(stateHash);
  if (!stateElements || stateElements.length === 0) {
    return undefined;
  }

  // Find the discovered state with the most overlap
  let bestMatch: UIBridgeDiscoveredState | undefined;
  let bestOverlap = 0;

  for (const state of discoveredStates) {
    // Use state_image_ids as a proxy for elements in that state
    // In practice, we'd need a better mapping
    const overlap = state.state_image_ids.filter((id) =>
      stateElements.some((el) => el.includes(id) || id.includes(el))
    ).length;

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = state;
    }
  }

  return bestMatch?.name;
}

/**
 * Compute element diff between two states.
 *
 * @param beforeElements - Elements present before the transition
 * @param afterElements - Elements present after the transition
 * @returns Object with added and removed element arrays
 */
export function computeElementDiff(
  beforeElements: string[],
  afterElements: string[]
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(beforeElements);
  const afterSet = new Set(afterElements);

  const added = afterElements.filter((el) => !beforeSet.has(el));
  const removed = beforeElements.filter((el) => !afterSet.has(el));

  return { added, removed };
}

/**
 * Group transitions by their from state for visualization.
 */
export function groupTransitionsByFromState(
  transitions: SuggestedTransition[]
): Map<string, SuggestedTransition[]> {
  const grouped = new Map<string, SuggestedTransition[]>();

  for (const transition of transitions) {
    const existing = grouped.get(transition.fromStateHash) || [];
    existing.push(transition);
    grouped.set(transition.fromStateHash, existing);
  }

  return grouped;
}

/**
 * Get all unique state hashes from transitions.
 */
export function getUniqueStates(
  transitions: SuggestedTransition[]
): Set<string> {
  const states = new Set<string>();

  for (const transition of transitions) {
    states.add(transition.fromStateHash);
    states.add(transition.toStateHash);
  }

  return states;
}

/**
 * Calculate confidence distribution for transitions.
 */
export function getConfidenceDistribution(transitions: SuggestedTransition[]): {
  high: number;
  medium: number;
  low: number;
} {
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const transition of transitions) {
    if (transition.confidence >= 0.7) {
      high++;
    } else if (transition.confidence >= 0.4) {
      medium++;
    } else {
      low++;
    }
  }

  return { high, medium, low };
}
