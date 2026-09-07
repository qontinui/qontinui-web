"use client";

import { toast } from "sonner";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  createCoordPolicy,
  deleteCoordPolicy,
  patchCoordPolicy,
} from "../../_shared/coordPolicyApi";
import { useCoordPolicies } from "../../_shared/useCoordPolicies";
import {
  buildCreateBody,
  isDecisionPolicyRow,
  DECISION_POLICY_DOMAINS,
  type AutonomyLevel,
  type DecisionPolicyCreate,
  type DecisionPolicyGraduation,
  type DecisionPolicyInput,
  type DecisionPolicyUpdate,
} from "../decisionPolicies";

/**
 * Presentation order: coord's own domain order (`DOMAIN_SPECS`), then the
 * resolver's tie-break within a domain (`priority ASC, created_at ASC`), so the
 * row a consult would actually match sorts first inside its domain group.
 */
function byDomainThenPriority(a: CoordPolicyRow, b: CoordPolicyRow): number {
  const ia = DECISION_POLICY_DOMAINS.findIndex(
    (s) => s.domain === a.decision_domain
  );
  const ib = DECISION_POLICY_DOMAINS.findIndex(
    (s) => s.domain === b.decision_domain
  );
  if (ia !== ib) return ia - ib;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/**
 * The decision-policy authoring surface's data layer.
 *
 * Built on `_shared/useCoordPolicies` — the one coord-policy CRUD chain, shared
 * with `/admin/coord/automation-rules` and `/admin/coord/gate-clearance` — plus
 * three facts about THIS store that the shared layer must not assume:
 *
 *  1. **A row's payload cannot be PATCHed.** Coord's `UpdatePolicyRequest` has
 *     no `payload` field, so changing a rule body means replacing the row
 *     ([`replaceRule`]) — and a replacement lands at the `always_escalate`
 *     column default, so replacing a GRADUATED row de-graduates it. That is a
 *     safe direction (coord escalates rather than acts) but it is a real
 *     consequence, so the toast says it happened.
 *  2. **Graduation is its own act.** `autonomy_level` is PATCH-only by design
 *     (coord#920) and is the only field on this page that changes what coord
 *     DOES. It gets its own call, its own body type and its own toast, so it
 *     can never ride along unnoticed with a rename.
 *  3. **Every write path needs its own failure sentence.** The shared `step`
 *     drops its `Failed to …` headline whenever the error carries a message,
 *     so a bare `Forbidden` from a create and from a graduation render
 *     identically. On this surface those are different acts with different
 *     recoveries, so [`attempt`] always prefixes the operation and appends the
 *     server's own text rather than replacing one with the other.
 *
 * The system-override routes are deliberately not re-exported, for the reason
 * `useCoordPolicies.overrideSystemRule` documents: they are v1-shaped and the
 * v2 domain resolver ignores override rows, so a "disable this built-in"
 * control would report success while the built-in kept deciding.
 */
export function useDecisionPolicies() {
  const { rules, loading, saving, loadFailed, reload, runSequence } =
    useCoordPolicies<DecisionPolicyCreate, DecisionPolicyUpdate>({
      // Module-level (stable) — the shared hook memoizes its loader on these.
      filter: isDecisionPolicyRow,
      sort: byDomainThenPriority,
      noun: "decision policy",
      loadFailMessage: "Failed to load decision policies",
    });

  /**
   * One write, with an operation-named outcome either way. `runSequence` holds
   * the saving flag and reloads once at the end — including on the failure
   * path, which is what makes the refreshed list the evidence for a request
   * that failed on the RESPONSE with the row already written.
   */
  const attempt = async (
    run: () => Promise<unknown>,
    okMessage: string,
    failHeadline: string
  ): Promise<boolean> =>
    runSequence(async () => {
      try {
        await run();
        toast.success(okMessage);
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `${failHeadline}: ${err.message}`
            : failHeadline
        );
        return false;
      }
    });

  const create = (input: DecisionPolicyInput): Promise<boolean> =>
    attempt(
      () => createCoordPolicy<DecisionPolicyCreate>(buildCreateBody(input)),
      "Decision policy created — it lands at always_escalate and arms nothing",
      "Failed to create the decision policy"
    );

  /** Name / repo / priority / rationale only — coord cannot PATCH `payload`,
   *  and `autonomy_level` goes through [`graduate`]. */
  const patchRule = (
    policyId: string,
    body: DecisionPolicyUpdate
  ): Promise<boolean> =>
    attempt(
      () => patchCoordPolicy<DecisionPolicyUpdate>(policyId, body),
      "Decision policy updated",
      "Failed to update the decision policy"
    );

  /** The graduation: the one PATCH that changes what coord does. */
  const graduate = (
    policyId: string,
    autonomyLevel: AutonomyLevel
  ): Promise<boolean> =>
    attempt(
      () =>
        patchCoordPolicy<DecisionPolicyGraduation>(policyId, {
          autonomy_level: autonomyLevel,
        }),
      `Autonomy set to ${autonomyLevel}`,
      "Failed to change the autonomy level"
    );

  const deleteRule = (policyId: string): Promise<boolean> =>
    attempt(
      () => deleteCoordPolicy(policyId),
      "Decision policy deleted",
      "Failed to delete the decision policy"
    );

  /**
   * Replace a rule whose payload, domain or mode changed — none of the three
   * is PATCHable. The honest two-step, in the order gate-clearance established
   * and for the same reason:
   *
   *   1. create the replacement. The OLD rule still decides: same band, same
   *      priority, and the resolver's `created_at ASC` tie-break favours the
   *      older row.
   *   2. delete the old rule.
   *
   * There is no instant with NO rule for the domain, so a consult can never
   * fall through to `escalated_no_policy` mid-edit. If step 2 fails, both rows
   * exist and the OLD one still decides — the message says only that, and
   * points at the refreshed list.
   *
   * The replacement lands at `always_escalate` whatever the old row's level
   * was: coord has no create-time autonomy field. That is the safe direction,
   * and it is reported rather than left for the operator to notice.
   */
  const replaceRule = async (
    previous: CoordPolicyRow,
    input: DecisionPolicyInput
  ): Promise<boolean> =>
    runSequence(async () => {
      try {
        await createCoordPolicy<DecisionPolicyCreate>(buildCreateBody(input));
      } catch (err) {
        // NOT "nothing changed": a request can fail on the RESPONSE (timeout,
        // 502 after commit) with the row already written. The refreshed list
        // `runSequence` fetches is the honest evidence — point at it.
        toast.error(
          (err instanceof Error ? `${err.message}. ` : "") +
            "The replacement decision policy was not confirmed. The list has been refreshed — " +
            "check whether a duplicate row was created before retrying."
        );
        return false;
      }
      try {
        await deleteCoordPolicy(previous.policy_id);
      } catch (err) {
        toast.error(
          (err instanceof Error ? `${err.message}. ` : "") +
            "The new row was created but the old one could not be removed. Both are listed, " +
            "and the old one still decides — delete it to finish the change."
        );
        return false;
      }
      toast.success(
        previous.autonomy_level === "always_escalate"
          ? "Decision policy replaced"
          : `Decision policy replaced — the new row lands at always_escalate, so it is no longer ${previous.autonomy_level}`
      );
      return true;
    });

  return {
    rules,
    loading,
    saving,
    loadFailed,
    reload,
    create,
    patchRule,
    graduate,
    deleteRule,
    replaceRule,
  };
}
