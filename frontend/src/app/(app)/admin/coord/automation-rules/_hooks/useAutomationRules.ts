"use client";

import { useCoordPolicies } from "../../_shared/useCoordPolicies";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import type { PolicyCreate, PolicyRow, PolicyUpdate, RuleKind } from "../types";

/** The two policy kinds the Automation Rules surface authors. */
const AUTHORED_KINDS: ReadonlySet<string> = new Set<RuleKind>([
  "terminal_auto_response",
  "question_auto_answer",
]);

/** Module-level (stable) so the shared hook's `loadRules` callback is stable. */
function isAuthoredRule(row: CoordPolicyRow): boolean {
  return row.kind !== null && AUTHORED_KINDS.has(row.kind);
}

function byPriorityDesc(a: CoordPolicyRow, b: CoordPolicyRow): number {
  return b.priority - a.priority;
}

/**
 * Loads and mutates tenant-scoped automation rules (coord policies) via the
 * tenant-admin coord-proxy (`/api/v1/operations/coord/policies`). The unified
 * replacement for the org-scoped `useAutoResponseRules` hook (#580, deleted in
 * the Phase 5 cutover): no `organizationService`/`useOrganization` — the
 * coord-proxy resolves the tenant from the operator bearer.
 *
 * The list is filtered to the two kinds this surface authors
 * (`terminal_auto_response`, `question_auto_answer`) so it doesn't show the
 * deterministic/guidance rows managed elsewhere (Policies page) or the v2
 * decision-domain rows managed by their own surfaces (Gate Clearance).
 *
 * The fetch/mutate chain itself lives in `_shared/useCoordPolicies` — this hook
 * is the automation-rules *policy* over it (which rows, which order, which
 * nouns), not a second copy of it.
 */
export function useAutomationRules() {
  const {
    rules,
    loading,
    saving,
    loadFailed,
    reload,
    createRule,
    updateRule,
    restoreDefault,
    deleteRule,
    overrideSystemRule,
    revertOverride,
  } = useCoordPolicies<PolicyCreate, PolicyUpdate>({
    filter: isAuthoredRule,
    sort: byPriorityDesc,
    noun: "rule",
    loadFailMessage: "Failed to load automation rules",
  });

  return {
    rules: rules as PolicyRow[],
    loading,
    saving,
    /**
     * The last list call FAILED, so `rules` is UNKNOWN — not "this workspace
     * has no rules". Re-exported because the surface must say so: an empty
     * array from a failed read used to render the "No automation rules yet"
     * card, which invites the operator to re-create a rule that already
     * exists. Since the off-switch became a soft DELETE, that false-empty is
     * also indistinguishable from the one state an operator most fears having
     * caused, so it must never be shown as a fact.
     */
    loadFailed,
    reload,
    // The list/editor callers only care whether the create landed.
    createRule: async (data: PolicyCreate) => (await createRule(data)) !== null,
    updateRule,
    restoreDefault,
    deleteRule,
    overrideRule: overrideSystemRule,
    revertOverride,
  };
}
