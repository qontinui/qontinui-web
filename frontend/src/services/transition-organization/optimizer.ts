import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
  RedundantTransition,
  OptimizationSuggestion,
  TransitionGroup,
} from "./types";

function areTransitionsIdentical(t1: Transition, t2: Transition): boolean {
  if (t1.type !== t2.type) return false;

  if (
    t1.timeout !== t2.timeout ||
    t1.retryCount !== t2.retryCount ||
    JSON.stringify(t1.workflows) !== JSON.stringify(t2.workflows)
  ) {
    return false;
  }

  if (t1.type === "OutgoingTransition" && t2.type === "OutgoingTransition") {
    const o1 = t1 as OutgoingTransition;
    const o2 = t2 as OutgoingTransition;

    return (
      o1.fromState === o2.fromState &&
      o1.toState === o2.toState &&
      o1.staysVisible === o2.staysVisible &&
      JSON.stringify(o1.activateStates) === JSON.stringify(o2.activateStates) &&
      JSON.stringify(o1.deactivateStates) ===
        JSON.stringify(o2.deactivateStates)
    );
  } else if (
    t1.type === "IncomingTransition" &&
    t2.type === "IncomingTransition"
  ) {
    const i1 = t1 as IncomingTransition;
    const i2 = t2 as IncomingTransition;

    return i1.toState === i2.toState;
  }

  return false;
}

function calculateArraySimilarity(arr1: string[], arr2: string[]): number {
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

function calculateTransitionSimilarity(t1: Transition, t2: Transition): number {
  if (t1.type !== t2.type) return 0;

  let score = 0;
  let factors = 0;

  factors++;
  const workflowSimilarity = calculateArraySimilarity(
    t1.workflows,
    t2.workflows
  );
  score += workflowSimilarity;

  factors++;
  if (t1.timeout === t2.timeout) score += 1;

  factors++;
  if (t1.retryCount === t2.retryCount) score += 1;

  if (t1.type === "OutgoingTransition" && t2.type === "OutgoingTransition") {
    const o1 = t1 as OutgoingTransition;
    const o2 = t2 as OutgoingTransition;

    factors++;
    if (o1.fromState === o2.fromState && o1.toState === o2.toState) score += 1;

    factors++;
    score += calculateArraySimilarity(o1.activateStates, o2.activateStates);

    factors++;
    score += calculateArraySimilarity(o1.deactivateStates, o2.deactivateStates);

    factors++;
    if (o1.staysVisible === o2.staysVisible) score += 1;
  } else if (
    t1.type === "IncomingTransition" &&
    t2.type === "IncomingTransition"
  ) {
    const i1 = t1 as IncomingTransition;
    const i2 = t2 as IncomingTransition;

    factors++;
    if (i1.toState === i2.toState) score += 1;
  }

  return factors > 0 ? score / factors : 0;
}

/**
 * Find redundant transitions
 */
export function findRedundantTransitions(
  transitions: Transition[]
): RedundantTransition[] {
  const redundant: RedundantTransition[] = [];

  for (let i = 0; i < transitions.length; i++) {
    const t1 = transitions[i];
    if (!t1) continue;

    const duplicates: string[] = [];

    for (let j = i + 1; j < transitions.length; j++) {
      const t2 = transitions[j];
      if (!t2) continue;

      if (areTransitionsIdentical(t1, t2)) {
        duplicates.push(t2.id);
      }
    }

    if (duplicates.length > 0) {
      redundant.push({
        transitionId: t1.id,
        duplicateIds: duplicates,
        reason: "exact-duplicate",
        confidence: 1.0,
      });
    }
  }

  for (let i = 0; i < transitions.length; i++) {
    const t1 = transitions[i];
    if (!t1) continue;

    const similar: string[] = [];

    for (let j = i + 1; j < transitions.length; j++) {
      const t2 = transitions[j];
      if (!t2) continue;

      const similarity = calculateTransitionSimilarity(t1, t2);
      if (similarity > 0.8 && similarity < 1.0) {
        similar.push(t2.id);
      }
    }

    if (similar.length > 0) {
      redundant.push({
        transitionId: t1.id,
        duplicateIds: similar,
        reason: "similar-config",
        confidence: 0.8,
      });
    }
  }

  return redundant;
}

/**
 * Suggest transitions that could be merged
 */
export function suggestMergableTransitions(
  transitions: Transition[]
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  const pathGroups = new Map<string, string[]>();

  for (const transition of transitions) {
    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;
      const pathKey = `${outgoing.fromState}->${outgoing.toState}`;
      const group = pathGroups.get(pathKey) || [];
      group.push(transition.id);
      pathGroups.set(pathKey, group);
    }
  }

  for (const [path, transitionIds] of pathGroups.entries()) {
    if (transitionIds.length > 1) {
      suggestions.push({
        type: "merge",
        description: `Multiple transitions found for path ${path}`,
        transitionIds,
        impact: "medium",
        action: "Merge workflows into a single transition",
        autoApplicable: false,
      });
    }
  }

  const redundant = findRedundantTransitions(transitions);
  for (const r of redundant) {
    if (r.reason === "exact-duplicate") {
      suggestions.push({
        type: "remove",
        description: "Exact duplicate transition detected",
        transitionIds: [r.transitionId, ...r.duplicateIds],
        impact: "high",
        action: "Remove duplicate transitions",
        autoApplicable: true,
      });
    }
  }

  return suggestions;
}

/**
 * Suggest optimal transition ordering
 */
export function optimizeTransitionOrder(
  transitions: Transition[],
  _states: State[],
  getGroupsForTransition: (transitionId: string) => TransitionGroup[]
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  const timeoutGroups = new Map<number, string[]>();
  for (const transition of transitions) {
    const group = timeoutGroups.get(transition.timeout) || [];
    group.push(transition.id);
    timeoutGroups.set(transition.timeout, group);
  }

  if (timeoutGroups.size > 5) {
    suggestions.push({
      type: "timeout-adjustment",
      description: "Many different timeout values detected",
      transitionIds: transitions.map((t) => t.id),
      impact: "low",
      action: "Consider standardizing timeout values",
      autoApplicable: false,
    });
  }

  const ungroupedTransitions = transitions.filter((t) => {
    const groups = getGroupsForTransition(t.id);
    return groups.length === 0;
  });

  if (ungroupedTransitions.length > 10) {
    suggestions.push({
      type: "add-group",
      description: `${ungroupedTransitions.length} transitions are not organized in groups`,
      transitionIds: ungroupedTransitions.map((t) => t.id),
      impact: "medium",
      action: "Organize transitions into logical groups",
      autoApplicable: false,
    });
  }

  return suggestions;
}
