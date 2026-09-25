"use client";

import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import {
  isPolicyWriteLevel,
  POLICY_WRITE_DEFAULT_LEVEL,
  POLICY_WRITE_DOMAIN,
  POLICY_WRITE_FAIL_CLOSED_LEVEL,
  type PolicyWriteLevel,
} from "../types";

/**
 * The `policy_write` fleet-policy dial — how much of the agent policy-write
 * surface this tenant permits.
 *
 * Plan `2026-08-06-agent-policy-replace-and-write-autonomy-dial` §4.
 *
 * Built on `_shared/useTenantFleetPolicyDial`, which holds properties 1 and 2
 * below for every dial (plus tenant-band writes and the refresh-vs-write race
 * guard):
 *
 * 1. **What is displayed is what devices resolve, never what was written.**
 *    Coord folds `master_enabled` in and lets a more specific scope band win, so
 *    a successful write does not entail the value the fleet sees. Every state
 *    transition here comes from a READ; the write's own echo is kept separately
 *    (`lastWrite`) so the two can be compared rather than conflated.
 *
 * 2. **A failed read-back is UNKNOWN.** On `readback_error` the last known-good
 *    value stays on screen and the error is surfaced. Painting the written level
 *    on an unconfirmed write is how a dial starts lying about the fleet.
 *
 * Three things are specific to THIS domain:
 *
 * **`"none"` does not mean `off`.** Coord answers `effective_level: "off"` for
 * both "nobody ever wrote a row" and "an operator turned it off", and for
 * `policy_write` those resolve in OPPOSITE directions: no row means the code
 * default `tightening_only` — today's shipped behaviour — while a disabled row
 * genuinely means off. Rendering the raw `effective_level` would tell every
 * tenant that has never touched the dial that agent policy writes are disabled,
 * when they are working normally. [`displayLevel`] applies the same rule coord's
 * `resolve_policy_write_level` applies, and `isDefaulted` says which case it is
 * so the UI can label it rather than imply an operator chose it.
 *
 * **An unparseable level is `off`, not the default.** `level` is free text on
 * every layer, so a hand-written or typo'd row reaches this hook verbatim: the
 * generic fleet-policy GET is domain-agnostic and does not parse it, while
 * coord's enforcement path runs `parse_fail_closed` and refuses everything.
 * [`displayLevel`] therefore resolves an unrecognized string the way the fleet
 * resolves it, and [`unrecognizedLevel`] carries the raw value so the UI can say
 * which row to fix rather than presenting `off` as an operator's choice. Note
 * this is the OPPOSITE direction from the no-row case above, and deliberately
 * so — "nobody ruled" and "somebody ruled unreadably" are different facts.
 *
 * **The dial is subtractive.** It never grants authority — the per-document
 * `agent_write_tier` control decides whether an agent may write a document at all,
 * and this dial can only narrow what happens to a write that control already
 * allowed. That is why this hook lives beside `AgentWriteAccessControl` rather
 * than on a settings page: they are two halves of one question, and the answer
 * is the more restrictive of them.
 */
export function usePolicyWritePolicy() {
  // Read, write and read-back — with the refresh-vs-write race guard — are
  // the shared tenant-band dial's; this hook adds only the domain's level
  // vocabulary below.
  const dial = useTenantFleetPolicyDial<PolicyWriteLevel>(
    POLICY_WRITE_DOMAIN,
    "agent policy-write autonomy"
  );
  const { policy } = dial;

  // `"none"` means no row matched, which for this domain is the code default —
  // NOT off. Mirrors coord's `resolve_policy_write_level`; if the two ever
  // disagree the console misreports the fleet.
  const isDefaulted = policy?.resolved_scope === "none";

  // A row exists but its level is not in the vocabulary. Coord's GET is
  // domain-agnostic and hands back the raw stored string, while coord's
  // ENFORCEMENT path runs `parse_fail_closed` and resolves the same string to
  // `off`. Rendering the raw value here would show a typo'd row as the level in
  // force while agents are in fact being refused outright — so this resolves it
  // the way the fleet does, and keeps the raw string to say WHY.
  //
  // Note this is deliberately NOT the no-row default: no row means nobody
  // expressed an opinion (today's shipped behaviour applies); an unparseable
  // row means somebody expressed one coord cannot read, which is the more
  // alarming fact and resolves in the opposite direction.
  const unrecognizedLevel: string | null =
    policy && !isDefaulted && !isPolicyWriteLevel(policy.effective_level)
      ? policy.effective_level
      : null;

  // Calls the guard again rather than branching on `unrecognizedLevel`, so the
  // narrowing is TypeScript's own and no cast is needed to reach a
  // `PolicyWriteLevel`. A cast here would be checked by nothing.
  const displayLevel: PolicyWriteLevel | null = !policy
    ? null
    : isDefaulted
      ? POLICY_WRITE_DEFAULT_LEVEL
      : isPolicyWriteLevel(policy.effective_level)
        ? policy.effective_level
        : POLICY_WRITE_FAIL_CLOSED_LEVEL;

  return {
    ...dial,
    /**
     * The level actually in force: the no-row case resolved to the code
     * default, an unparseable row resolved fail-closed the way coord enforces
     * it. Always one of the four known levels, or `null` before the first read.
     * Prefer this over `policy.effective_level` in the UI.
     */
    displayLevel,
    /** True when no row exists, so `displayLevel` is coord's built-in default. */
    isDefaulted,
    /**
     * The raw level string coord returned when it is NOT one this console
     * knows. `displayLevel` has already been resolved fail-closed; this exists
     * so the UI can name the row that needs fixing instead of silently
     * presenting `off` as though an operator chose it.
     */
    unrecognizedLevel,
  };
}
