import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
  ValidationIssue,
  ValidationReport,
  CircularPath,
} from "./types";

/**
 * Validate all transitions for broken references
 */
export function validateTransitions(
  transitions: Transition[],
  states: State[],
  workflows: { id: string }[]
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const stateIds = new Set(states.map((s) => s.id));
  const workflowIds = new Set(workflows.map((w) => w.id));

  for (const transition of transitions) {
    for (const workflowId of transition.workflows) {
      if (!workflowIds.has(workflowId)) {
        issues.push({
          severity: "error",
          type: "missing-workflow",
          message: `Transition references non-existent workflow: ${workflowId}`,
          transitionId: transition.id,
          relatedIds: [workflowId],
          suggestion:
            "Remove the workflow reference or create the missing workflow",
        });
      }
    }

    if (transition.type === "OutgoingTransition") {
      const outgoing = transition as OutgoingTransition;

      if (!stateIds.has(outgoing.fromState)) {
        issues.push({
          severity: "error",
          type: "broken-reference",
          message: `Transition references non-existent source state: ${outgoing.fromState}`,
          transitionId: transition.id,
          relatedIds: [outgoing.fromState],
          suggestion: "Update the fromState or delete this transition",
        });
      }

      if (outgoing.toState && !stateIds.has(outgoing.toState)) {
        issues.push({
          severity: "error",
          type: "broken-reference",
          message: `Transition references non-existent target state: ${outgoing.toState}`,
          transitionId: transition.id,
          relatedIds: [outgoing.toState],
          suggestion: "Update the toState or delete this transition",
        });
      }

      for (const stateId of outgoing.activateStates) {
        if (!stateIds.has(stateId)) {
          issues.push({
            severity: "warning",
            type: "broken-reference",
            message: `Transition activates non-existent state: ${stateId}`,
            transitionId: transition.id,
            relatedIds: [stateId],
            suggestion: "Remove the state from activateStates",
          });
        }
      }

      for (const stateId of outgoing.deactivateStates) {
        if (!stateIds.has(stateId)) {
          issues.push({
            severity: "warning",
            type: "broken-reference",
            message: `Transition deactivates non-existent state: ${stateId}`,
            transitionId: transition.id,
            relatedIds: [stateId],
            suggestion: "Remove the state from deactivateStates",
          });
        }
      }
    } else {
      const incoming = transition as IncomingTransition;

      if (!stateIds.has(incoming.toState)) {
        issues.push({
          severity: "error",
          type: "broken-reference",
          message: `Transition references non-existent target state: ${incoming.toState}`,
          transitionId: transition.id,
          relatedIds: [incoming.toState],
          suggestion: "Update the toState or delete this transition",
        });
      }
    }

    if (transition.timeout < 0) {
      issues.push({
        severity: "warning",
        type: "timeout",
        message: `Transition has negative timeout: ${transition.timeout}`,
        transitionId: transition.id,
        suggestion: "Set timeout to a positive value or 0 for no timeout",
      });
    }

    if (transition.workflows.length === 0) {
      issues.push({
        severity: "info",
        type: "configuration",
        message: "Transition has no workflows configured",
        transitionId: transition.id,
        suggestion: "Add workflows to define the transition behavior",
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  return {
    totalTransitions: transitions.length,
    validTransitions:
      transitions.length - new Set(issues.map((i) => i.transitionId)).size,
    transitionsWithIssues: new Set(issues.map((i) => i.transitionId)).size,
    issues,
    errorCount,
    warningCount,
    infoCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate a single transition
 */
export function validateTransition(
  transition: Transition,
  states: State[],
  workflows: { id: string }[]
): ValidationIssue[] {
  const report = validateTransitions([transition], states, workflows);
  return report.issues.filter((i) => i.transitionId === transition.id);
}

/**
 * Check for duplicate or conflicting transitions
 */
export function checkForConflicts(
  transition: Transition,
  allTransitions: Transition[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const existing of allTransitions) {
    if (existing.id === transition.id) continue;

    if (
      transition.type === existing.type &&
      JSON.stringify(transition.workflows) ===
        JSON.stringify(existing.workflows)
    ) {
      if (transition.type === "OutgoingTransition") {
        const t1 = transition as OutgoingTransition;
        const t2 = existing as OutgoingTransition;

        if (
          t1.fromState === t2.fromState &&
          t1.toState === t2.toState &&
          JSON.stringify(t1.activateStates) ===
            JSON.stringify(t2.activateStates) &&
          JSON.stringify(t1.deactivateStates) ===
            JSON.stringify(t2.deactivateStates)
        ) {
          issues.push({
            severity: "warning",
            type: "duplicate",
            message: "Duplicate transition detected",
            transitionId: transition.id,
            relatedIds: [existing.id],
            suggestion:
              "Consider merging or removing one of the duplicate transitions",
          });
        }
      } else {
        const t1 = transition as IncomingTransition;
        const t2 = existing as IncomingTransition;

        if (t1.toState === t2.toState) {
          issues.push({
            severity: "warning",
            type: "duplicate",
            message: "Duplicate incoming transition detected",
            transitionId: transition.id,
            relatedIds: [existing.id],
            suggestion:
              "Consider merging or removing one of the duplicate transitions",
          });
        }
      }
    }

    if (
      transition.type === "OutgoingTransition" &&
      existing.type === "OutgoingTransition"
    ) {
      const t1 = transition as OutgoingTransition;
      const t2 = existing as OutgoingTransition;

      if (t1.fromState === t2.fromState && t1.toState === t2.toState) {
        const conflictingActivations = t1.activateStates.filter((sid) =>
          t2.deactivateStates.includes(sid)
        );

        if (conflictingActivations.length > 0) {
          issues.push({
            severity: "warning",
            type: "conflict",
            message: "Conflicting state activation/deactivation detected",
            transitionId: transition.id,
            relatedIds: [existing.id, ...conflictingActivations],
            suggestion: "Review state activation/deactivation logic",
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Validate the entire transition graph (including circular paths and unreachable states)
 */
export function validateTransitionGraph(
  transitions: Transition[],
  states: State[],
  workflows: { id: string }[],
  findCircularTransitions: (transitions: Transition[]) => CircularPath[],
  findUnreachableStates: (
    transitions: Transition[],
    states: State[]
  ) => string[]
): ValidationReport {
  const report = validateTransitions(transitions, states, workflows);

  const circularPaths = findCircularTransitions(transitions);
  for (const path of circularPaths) {
    for (const transitionId of path.transitions) {
      report.issues.push({
        severity: "warning",
        type: "circular-path",
        message: `Transition is part of a circular path: ${path.path.join(" -> ")}`,
        transitionId,
        relatedIds: path.transitions,
        suggestion: "Add exit conditions to prevent infinite loops",
      });
    }
  }

  const unreachableStates = findUnreachableStates(transitions, states);
  if (unreachableStates.length > 0) {
    for (const transition of transitions) {
      if (transition.type === "OutgoingTransition") {
        const outgoing = transition as OutgoingTransition;
        if (
          outgoing.toState &&
          unreachableStates.includes(outgoing.toState)
        ) {
          report.issues.push({
            severity: "info",
            type: "unreachable",
            message: `Transition leads to an unreachable state: ${outgoing.toState}`,
            transitionId: transition.id,
            relatedIds: [outgoing.toState],
            suggestion:
              "Add incoming transitions to make the state reachable from initial states",
          });
        }
      }
    }
  }

  report.errorCount = report.issues.filter(
    (i) => i.severity === "error"
  ).length;
  report.warningCount = report.issues.filter(
    (i) => i.severity === "warning"
  ).length;
  report.infoCount = report.issues.filter(
    (i) => i.severity === "info"
  ).length;

  return report;
}

/**
 * Get a comprehensive validation report
 */
export function getValidationReport(
  transitions: Transition[],
  states: State[],
  workflows: { id: string }[],
  findCircularTransitions: (transitions: Transition[]) => CircularPath[],
  findUnreachableStates: (
    transitions: Transition[],
    states: State[]
  ) => string[]
): ValidationReport {
  return validateTransitionGraph(
    transitions,
    states,
    workflows,
    findCircularTransitions,
    findUnreachableStates
  );
}
