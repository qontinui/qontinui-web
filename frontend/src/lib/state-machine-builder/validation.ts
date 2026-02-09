import type { UIBridgeState, UIBridgeTransition } from "./types";

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  type:
    | "unreachable"
    | "dead-end"
    | "disconnected"
    | "self-loop"
    | "no-transitions";
  stateId?: string;
  message: string;
  severity: IssueSeverity;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  isValid: boolean;
}

/** Validate graph structure and return issues */
export function validateStateMachine(
  states: UIBridgeState[],
  transitions: UIBridgeTransition[]
): ValidationResult {
  if (states.length === 0) {
    return { issues: [], isValid: true };
  }

  const issues: ValidationIssue[] = [];
  const stateIds = new Set(states.map((s) => s.id));
  const globalIds = new Set(states.filter((s) => s.isGlobal).map((s) => s.id));

  // Build adjacency lists
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const id of stateIds) {
    outgoing.set(id, new Set());
    incoming.set(id, new Set());
  }
  for (const t of transitions) {
    outgoing.get(t.from)?.add(t.to);
    incoming.get(t.to)?.add(t.from);
  }

  // Self-loops (info)
  for (const t of transitions) {
    if (t.from === t.to) {
      const name = states.find((s) => s.id === t.from)?.name ?? t.from;
      issues.push({
        type: "self-loop",
        stateId: t.from,
        message: `"${name}" has a self-loop transition`,
        severity: "info",
      });
    }
  }

  // No transitions at all
  for (const s of states) {
    if (s.isGlobal) continue;
    const out = outgoing.get(s.id)?.size ?? 0;
    const inc = incoming.get(s.id)?.size ?? 0;
    if (out === 0 && inc === 0) {
      issues.push({
        type: "no-transitions",
        stateId: s.id,
        message: `"${s.name}" has no incoming or outgoing transitions`,
        severity: "warning",
      });
    }
  }

  // Dead ends: incoming but no outgoing (skip globals)
  for (const s of states) {
    if (s.isGlobal) continue;
    const out = outgoing.get(s.id)?.size ?? 0;
    const inc = incoming.get(s.id)?.size ?? 0;
    if (inc > 0 && out === 0) {
      issues.push({
        type: "dead-end",
        stateId: s.id,
        message: `"${s.name}" is a dead end (no outgoing transitions)`,
        severity: "warning",
      });
    }
  }

  // Unreachable: outgoing but no incoming (skip globals)
  for (const s of states) {
    if (s.isGlobal) continue;
    const out = outgoing.get(s.id)?.size ?? 0;
    const inc = incoming.get(s.id)?.size ?? 0;
    if (out > 0 && inc === 0) {
      issues.push({
        type: "unreachable",
        stateId: s.id,
        message: `"${s.name}" is unreachable (no incoming transitions)`,
        severity: "warning",
      });
    }
  }

  // Disconnected subgraphs: find connected components (undirected) among non-global states
  const nonGlobalStates = states.filter((s) => !s.isGlobal);
  if (nonGlobalStates.length > 1 && transitions.length > 0) {
    const parent = new Map<string, string>();
    for (const s of nonGlobalStates) parent.set(s.id, s.id);

    function find(x: string): string {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    }

    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    for (const t of transitions) {
      if (
        !globalIds.has(t.from) &&
        !globalIds.has(t.to) &&
        parent.has(t.from) &&
        parent.has(t.to)
      ) {
        union(t.from, t.to);
      }
    }

    // Count distinct components among states that have at least one transition
    const connectedStates = nonGlobalStates.filter(
      (s) =>
        (outgoing.get(s.id)?.size ?? 0) > 0 ||
        (incoming.get(s.id)?.size ?? 0) > 0
    );
    const roots = new Set(connectedStates.map((s) => find(s.id)));
    if (roots.size > 1) {
      issues.push({
        type: "disconnected",
        message: `Graph has ${roots.size} disconnected subgraphs`,
        severity: "warning",
      });
    }
  }

  // Sort: errors first, then warnings, then info
  const severityOrder: Record<IssueSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    issues,
    isValid: issues.filter((i) => i.severity === "error").length === 0,
  };
}
