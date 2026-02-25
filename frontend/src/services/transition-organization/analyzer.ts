import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
  CircularPath,
  TransitionStatistics,
  TransitionMatrix,
  TransitionPattern,
  TransitionFilter,
  TransitionGroup,
} from "./types";

/**
 * Build a transition graph for analysis
 */
export function buildTransitionGraph(
  transitions: Transition[]
): Map<string, Array<{ toState: string; transitionId: string }>> {
  const graph = new Map<
    string,
    Array<{ toState: string; transitionId: string }>
  >();

  for (const transition of transitions) {
    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;
      if (!outgoing.toState) continue;

      const edges = graph.get(outgoing.fromState) || [];
      edges.push({ toState: outgoing.toState, transitionId: transition.id });
      graph.set(outgoing.fromState, edges);
    }
  }

  return graph;
}

/**
 * Find circular transition paths
 */
export function findCircularTransitions(
  transitions: Transition[]
): CircularPath[] {
  const circularPaths: CircularPath[] = [];
  const graph = buildTransitionGraph(transitions);

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const currentPath: string[] = [];
  const currentTransitions: string[] = [];

  const dfs = (stateId: string): void => {
    visited.add(stateId);
    recursionStack.add(stateId);
    currentPath.push(stateId);

    const neighbors = graph.get(stateId) || [];
    for (const { toState, transitionId } of neighbors) {
      currentTransitions.push(transitionId);

      if (!visited.has(toState)) {
        dfs(toState);
      } else if (recursionStack.has(toState)) {
        const cycleStart = currentPath.indexOf(toState);
        const cyclePath = currentPath.slice(cycleStart);
        const cycleTransitions = currentTransitions.slice(cycleStart);

        circularPaths.push({
          path: cyclePath,
          transitions: cycleTransitions,
          length: cyclePath.length,
        });
      }

      currentTransitions.pop();
    }

    currentPath.pop();
    recursionStack.delete(stateId);
  };

  for (const transition of transitions) {
    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;
      if (!visited.has(outgoing.fromState)) {
        dfs(outgoing.fromState);
      }
    }
  }

  return circularPaths;
}

/**
 * Find unreachable states (states with no path from initial states)
 */
export function findUnreachableStates(
  transitions: Transition[],
  states: State[]
): string[] {
  const initialStates = new Set(
    states.filter((s) => s.initial).map((s) => s.id)
  );

  const reachable = new Set<string>(initialStates);
  const queue = Array.from(initialStates);
  const graph = buildTransitionGraph(transitions);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.get(current) || [];

    for (const { toState } of neighbors) {
      if (!reachable.has(toState)) {
        reachable.add(toState);
        queue.push(toState);
      }
    }
  }

  return states
    .filter((s) => !reachable.has(s.id) && !s.initial)
    .map((s) => s.id);
}

/**
 * Get comprehensive transition statistics
 */
export function getTransitionStatistics(
  transitions: Transition[],
  states: State[],
  allGroups: TransitionGroup[]
): TransitionStatistics {
  const outgoingCount = transitions.filter(
    (t) => t.type === "OutgoingTransition"
  ).length;
  const incomingCount = transitions.filter(
    (t) => t.type === "IncomingTransition"
  ).length;

  const totalTimeout = transitions.reduce((sum, t) => sum + t.timeout, 0);
  const totalRetryCount = transitions.reduce((sum, t) => sum + t.retryCount, 0);

  const withWorkflows = transitions.filter(
    (t) => t.workflows.length > 0
  ).length;
  const withoutWorkflows = transitions.length - withWorkflows;

  const workflowCounts = new Map<string, number>();
  for (const transition of transitions) {
    for (const workflowId of transition.workflows) {
      workflowCounts.set(workflowId, (workflowCounts.get(workflowId) || 0) + 1);
    }
  }

  const topWorkflows = Array.from(workflowCounts.entries())
    .map(([workflowId, count]) => ({ workflowId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const stateCounts = new Map<
    string,
    { incomingCount: number; outgoingCount: number }
  >();
  for (const state of states) {
    stateCounts.set(state.id, { incomingCount: 0, outgoingCount: 0 });
  }

  for (const transition of transitions) {
    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;
      const fromCount = stateCounts.get(outgoing.fromState);
      if (fromCount) fromCount.outgoingCount++;

      if (outgoing.toState) {
        const toCount = stateCounts.get(outgoing.toState);
        if (toCount) toCount.incomingCount++;
      }
    } else {
      const incoming = transition as IncomingTransition;
      const toCount = stateCounts.get(incoming.toState);
      if (toCount) toCount.incomingCount++;
    }
  }

  const topStates = Array.from(stateCounts.entries())
    .map(([stateId, counts]) => ({ stateId, ...counts }))
    .sort(
      (a, b) =>
        b.incomingCount + b.outgoingCount - (a.incomingCount + a.outgoingCount)
    )
    .slice(0, 10);

  const circularPaths = findCircularTransitions(transitions);
  const unreachableStates = findUnreachableStates(transitions, states);

  const stateIds = new Set(states.map((s) => s.id));
  const orphanedTransitions = transitions.filter((t) => {
    if (t.type === "OutgoingTransition") {
      const outgoing = t as OutgoingTransition;
      return (
        !stateIds.has(outgoing.fromState) ||
        (outgoing.toState && !stateIds.has(outgoing.toState))
      );
    } else {
      const incoming = t as IncomingTransition;
      return !stateIds.has(incoming.toState);
    }
  }).length;

  const totalGroups = allGroups.length;
  const avgTransitionsPerGroup =
    totalGroups > 0
      ? allGroups.reduce((sum, g) => sum + g.transitionIds.length, 0) /
        totalGroups
      : 0;

  return {
    total: transitions.length,
    byType: {
      outgoing: outgoingCount,
      incoming: incomingCount,
    },
    avgTimeout: transitions.length > 0 ? totalTimeout / transitions.length : 0,
    avgRetryCount:
      transitions.length > 0 ? totalRetryCount / transitions.length : 0,
    withWorkflows,
    withoutWorkflows,
    topWorkflows,
    topStates,
    circularPaths: circularPaths.length,
    unreachableStates: unreachableStates.length,
    orphanedTransitions,
    groups: {
      total: totalGroups,
      avgTransitionsPerGroup,
    },
  };
}

/**
 * Search transitions with query and filters
 */
export function searchTransitions(
  transitions: Transition[],
  query: string,
  filters: TransitionFilter | undefined,
  getTransitionMetadata: (id: string) => unknown,
  getGroupById: (id: string) => TransitionGroup | undefined
): Transition[] {
  let results = [...transitions];

  if (query) {
    const lowerQuery = query.toLowerCase();
    results = results.filter((t) => {
      const metadata = getTransitionMetadata(t.id) as
        | { name?: string; description?: string }
        | undefined;
      const searchableText = [
        t.id,
        t.workflows.join(" "),
        metadata?.name || "",
        metadata?.description || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(lowerQuery);
    });
  }

  if (filters) {
    if (filters.type) {
      results = results.filter((t) => t.type === filters.type);
    }

    if (filters.fromState) {
      results = results.filter(
        (t) =>
          t.type === "OutgoingTransition" &&
          (t as OutgoingTransition).fromState === filters.fromState
      );
    }

    if (filters.toState) {
      results = results.filter((t) => {
        if (t.type === "OutgoingTransition") {
          return (t as OutgoingTransition).toState === filters.toState;
        } else {
          return (t as IncomingTransition).toState === filters.toState;
        }
      });
    }

    if (filters.hasWorkflow) {
      results = results.filter((t) =>
        t.workflows.includes(filters.hasWorkflow!)
      );
    }

    if (filters.timeoutRange) {
      results = results.filter(
        (t) =>
          t.timeout >= filters.timeoutRange!.min &&
          t.timeout <= filters.timeoutRange!.max
      );
    }

    if (filters.retryCountRange) {
      results = results.filter(
        (t) =>
          t.retryCount >= filters.retryCountRange!.min &&
          t.retryCount <= filters.retryCountRange!.max
      );
    }

    if (filters.staysVisible !== undefined) {
      results = results.filter(
        (t) =>
          t.type === "OutgoingTransition" &&
          (t as OutgoingTransition).staysVisible === filters.staysVisible
      );
    }

    if (filters.activatesState) {
      results = results.filter(
        (t) =>
          t.type === "OutgoingTransition" &&
          (t as OutgoingTransition).activateStates.includes(
            filters.activatesState!
          )
      );
    }

    if (filters.deactivatesState) {
      results = results.filter(
        (t) =>
          t.type === "OutgoingTransition" &&
          (t as OutgoingTransition).deactivateStates.includes(
            filters.deactivatesState!
          )
      );
    }

    if (filters.inGroup) {
      const group = getGroupById(filters.inGroup);
      if (group) {
        results = results.filter((t) => group.transitionIds.includes(t.id));
      }
    }

    if (filters.hasTag) {
      results = results.filter((t) => {
        const metadata = getTransitionMetadata(t.id) as
          | { tags?: string[] }
          | undefined;
        return metadata?.tags?.includes(filters.hasTag!);
      });
    }
  }

  return results;
}

/**
 * Get transitions for a specific state
 */
export function getTransitionsForState(
  transitions: Transition[],
  stateId: string,
  direction: "incoming" | "outgoing" | "both" = "both"
): Transition[] {
  return transitions.filter((t) => {
    if (direction === "incoming" || direction === "both") {
      if (
        t.type === "OutgoingTransition" &&
        (t as OutgoingTransition).toState === stateId
      ) {
        return true;
      }
      if (
        t.type === "IncomingTransition" &&
        (t as IncomingTransition).toState === stateId
      ) {
        return true;
      }
    }

    if (direction === "outgoing" || direction === "both") {
      if (
        t.type === "OutgoingTransition" &&
        (t as OutgoingTransition).fromState === stateId
      ) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Find transitions matching a pattern
 */
export function getTransitionsByPattern(
  transitions: Transition[],
  pattern: TransitionPattern
): Transition[] {
  const tolerance = pattern.tolerance || 0.8;

  return transitions.filter((t) => {
    let matches = 0;
    let checks = 0;

    if (pattern.criteria.workflows) {
      checks++;
      const workflowMatch = pattern.criteria.workflows.every((wid) =>
        t.workflows.includes(wid)
      );
      if (workflowMatch) matches++;
    }

    if (pattern.criteria.timeout !== undefined) {
      checks++;
      if (t.timeout === pattern.criteria.timeout) matches++;
    }

    if (pattern.criteria.retryCount !== undefined) {
      checks++;
      if (t.retryCount === pattern.criteria.retryCount) matches++;
    }

    if (t.type === "OutgoingTransition") {
      const outgoing = t as OutgoingTransition;

      if (pattern.criteria.activateStates) {
        checks++;
        const activateMatch = pattern.criteria.activateStates.every((sid) =>
          outgoing.activateStates.includes(sid)
        );
        if (activateMatch) matches++;
      }

      if (pattern.criteria.deactivateStates) {
        checks++;
        const deactivateMatch = pattern.criteria.deactivateStates.every((sid) =>
          outgoing.deactivateStates.includes(sid)
        );
        if (deactivateMatch) matches++;
      }
    }

    return checks > 0 && matches / checks >= tolerance;
  });
}

/**
 * Generate transition matrix data structure
 */
export function generateTransitionMatrix(
  transitions: Transition[],
  states: State[]
): TransitionMatrix {
  const stateIds = states.map((s) => s.id);
  const stateIndexMap = new Map(stateIds.map((id, i) => [id, i]));

  const matrix: (string[] | null)[][] = Array(stateIds.length)
    .fill(null)
    .map(() => Array(stateIds.length).fill(null));

  let totalTransitions = 0;
  for (const transition of transitions) {
    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;
      const fromIndex = stateIndexMap.get(outgoing.fromState);
      const toIndex = outgoing.toState
        ? stateIndexMap.get(outgoing.toState)
        : undefined;

      if (fromIndex !== undefined && toIndex !== undefined) {
        const row = matrix[fromIndex];
        if (row) {
          if (!row[toIndex]) {
            row[toIndex] = [];
          }
          row[toIndex]?.push(transition.id);
          totalTransitions++;
        }
      }
    }
  }

  const possibleConnections = stateIds.length * stateIds.length;
  const actualConnections = matrix
    .flat()
    .filter((cell) => cell !== null).length;
  const coverage =
    possibleConnections > 0 ? actualConnections / possibleConnections : 0;

  return {
    states: stateIds,
    matrix,
    metadata: {
      generated: new Date().toISOString(),
      totalTransitions,
      coverage,
    },
  };
}

/**
 * Export transition matrix as CSV
 */
export function exportTransitionMatrix(
  transitions: Transition[],
  states: State[]
): string {
  const matrix = generateTransitionMatrix(transitions, states);
  const lines: string[] = [];

  lines.push(["State", ...matrix.states].join(","));

  for (let i = 0; i < matrix.states.length; i++) {
    const row = [matrix.states[i]];
    for (let j = 0; j < matrix.states.length; j++) {
      const transitionIds = matrix.matrix[i]?.[j];
      row.push(transitionIds ? transitionIds.length.toString() : "0");
    }
    lines.push(row.join(","));
  }

  return lines.join("\n");
}
