"use client";

import { toast } from "sonner";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  createCoordPolicy,
  deleteCoordPolicy,
} from "../../_shared/coordPolicyApi";
import { useCoordPolicies } from "../../_shared/useCoordPolicies";
import {
  buildCreateBody,
  isGateClearanceRow,
  rawGateClass,
  type ClearanceAuthority,
  type GateClearanceCreate,
  type GateClearanceUpdate,
} from "../gateClearance";

/**
 * Presentation order: tenant rows first (they outrank system rows in coord's
 * resolver), then by class, then by the resolver's own tie-break
 * (`priority ASC, created_at ASC`).
 */
function byBandThenClass(a: CoordPolicyRow, b: CoordPolicyRow): number {
  const band = Number(a.built_in) - Number(b.built_in);
  if (band !== 0) return band;
  const ca = rawGateClass(a.payload) ?? "";
  const cb = rawGateClass(b.payload) ?? "";
  if (ca !== cb) return ca.localeCompare(cb);
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export interface ClearanceRuleInput {
  name: string;
  gateClass: string;
  authority: ClearanceAuthority;
  priority?: number;
  rationale?: string;
}

/**
 * The `gate_clearance` authoring surface's data layer.
 *
 * Built on `_shared/useCoordPolicies` (the one coord-policy CRUD chain) plus
 * two domain-specific facts the shared layer must not assume:
 *
 *  1. **A rule's class/authority cannot be PATCHed.** Coord's
 *     `UpdatePolicyRequest` has no `payload` field, so changing either requires
 *     replacing the row — [`replaceRule`] below.
 *  2. **The system-override routes are unusable here.** They are v1-shaped
 *     (`kind` + `condition` + `action`, no `payload`) and the v2 domain
 *     resolver ignores override rows entirely, so a "disable this built-in"
 *     toggle would report success while the built-in kept deciding. A tenant
 *     overrides a system default by authoring its OWN rule for the same class —
 *     tenant band outranks system band regardless of priority — and reverts by
 *     deleting it. `overrideSystemRule`/`revertOverride` are deliberately not
 *     re-exported.
 */
export function useGateClearanceRules() {
  const {
    rules,
    loading,
    saving,
    loadFailed,
    reload,
    createRule,
    updateRule,
    deleteRule,
    runSequence,
  } = useCoordPolicies<GateClearanceCreate, GateClearanceUpdate>({
    // Module-level (stable) — the shared hook memoizes its loader on these.
    filter: isGateClearanceRow,
    sort: byBandThenClass,
    noun: "clearance rule",
  });

  const create = async (input: ClearanceRuleInput): Promise<boolean> =>
    (await createRule(buildCreateBody(input))) !== null;

  /**
   * Replace a rule whose class or authority changed. Coord's
   * `UpdatePolicyRequest` has no `payload` field, so there is no in-place edit
   * of either — this is the honest two-step:
   *
   *   1. create the replacement. The OLD rule still decides: same band, same
   *      priority, and the resolver's `created_at ASC` tie-break favours the
   *      older row. (If the author also LOWERED the priority the new rule wins
   *      here instead — which is the intended end state, one step early.)
   *   2. delete the old rule. The replacement takes over, in one step.
   *
   * Deliberately NOT "disable the old rule, then delete it": a disabled row is
   * invisible in this console (the web proxy forwards no `enabled` filter to
   * coord — see `coordPolicyApi.listCoordPolicies`), so a failure after the
   * disable would strand an orphan the user could neither see nor clean up.
   *
   * There is no instant with NO rule for the class, so the change can never
   * pass through a transiently looser authority. If step 2 fails, BOTH rules
   * exist and are listed — which one decides is then whichever the resolver
   * ranks first (the old one, unless this edit also lowered the priority), so
   * the message says only what is certain: finish by deleting the old row.
   */
  const replaceRule = async (
    previous: CoordPolicyRow,
    input: ClearanceRuleInput
  ): Promise<boolean> =>
    runSequence(async () => {
      try {
        await createCoordPolicy<GateClearanceCreate>(buildCreateBody(input));
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `Replace failed — nothing changed: ${err.message}`
            : "Replace failed — nothing changed"
        );
        return false;
      }
      try {
        await deleteCoordPolicy(previous.policy_id);
      } catch (err) {
        toast.error(
          (err instanceof Error ? `${err.message}. ` : "") +
            "The new rule was created but the old one could not be removed. " +
            "Both are listed — delete the old one to finish the change."
        );
        return false;
      }
      toast.success("Clearance rule replaced");
      return true;
    });

  return {
    rules,
    loading,
    saving,
    loadFailed,
    reload,
    create,
    /** Name / priority / rationale only — coord cannot PATCH `payload`. */
    patchRule: updateRule,
    deleteRule,
    replaceRule,
  };
}
