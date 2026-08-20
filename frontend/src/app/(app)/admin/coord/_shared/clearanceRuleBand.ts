/**
 * Which BAND a gate's deciding `gate_clearance` rule came from.
 *
 * Coord stamps `gates.cleared_under_rule` with the `policy_id` of the rule that
 * admitted an agent clear, and NULL for the built-in defaults, operator routes
 * and reapers (`gates.rs`, `cleared_under_rule` comment). **The band itself is
 * not on the wire** — the gates read API returns the rule id and nothing else
 * about it — so the console derives it by looking the id up in the tenant's
 * current `gate_clearance` rule set, where coord's effective-set list route
 * annotates every row with `built_in`.
 *
 * The derivation is therefore honest but time-shifted: it describes the rule
 * **as it exists now**, not as it existed when the gate was cleared. Three
 * outcomes, and the third is the one that must never be guessed:
 *
 *  - `"tenant"`  — the id is a row this workspace owns.
 *  - `"system"`  — the id is a system built-in.
 *  - `"unknown"` — the set IS loaded and does NOT contain the id (the rule was
 *    deleted or replaced since the gate was cleared). Rendered as an explicit
 *    "band unknown", never as either band.
 *  - `null`      — the set was not loaded at all, so there is nothing to say.
 *    The line renders exactly as it did before bands existed: an un-annotated
 *    "under rule <id>". Saying nothing is not a claim; "(band unknown)" on
 *    every row of a page whose side-fetch failed would be, and it would also
 *    flash on first paint before the set arrives.
 */

import { isGateClearanceRow, ruleBand } from "../gate-clearance/gateClearance";
import type { CoordPolicyRow } from "./coordPolicies";

export type ClearanceRuleBand = "tenant" | "system" | "unknown";

/**
 * `policy_id → band` for every `gate_clearance` row in a rule set.
 *
 * `rules === null` means the set could not be loaded — pass `null` through
 * rather than an empty map, so "not loaded" stays distinguishable from "loaded
 * and the rule is gone". Both render as `"unknown"`, but only the second is a
 * statement about the corpus.
 */
export function clearanceBandIndex(
  rules: readonly CoordPolicyRow[] | null
): ReadonlyMap<string, ClearanceRuleBand> | null {
  if (rules === null) return null;
  const index = new Map<string, ClearanceRuleBand>();
  for (const row of rules) {
    if (!isGateClearanceRow(row)) continue;
    index.set(row.policy_id, ruleBand(row));
  }
  return index;
}

/**
 * The band for `ruleId`.
 *
 * `null` when no rule decided the gate, or when the rule set was never loaded
 * (no band claim either way). `"unknown"` ONLY for the informative case: the
 * set is loaded and does not contain the id.
 */
export function lookupClearanceBand(
  ruleId: string | null | undefined,
  index: ReadonlyMap<string, ClearanceRuleBand> | null
): ClearanceRuleBand | null {
  if (!ruleId) return null;
  if (index === null) return null;
  return index.get(ruleId) ?? "unknown";
}
