"use client";

import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import {
  isPolicyUpstreamLevel,
  POLICY_UPSTREAM_DEFAULT_LEVEL,
  POLICY_UPSTREAM_DOMAIN,
  POLICY_UPSTREAM_FAIL_CLOSED_LEVEL,
  type PolicyUpstreamLevel,
} from "../types";

/**
 * The `policy_upstream` fleet-policy dial — what happens to this tenant when
 * the fleet publishes a new version of a document it holds.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing` D6.
 *
 * Built on `_shared/useTenantFleetPolicyDial`, which holds the two
 * load-bearing properties below (its 1 and 2) for every dial, for the reasons
 * stated there:
 *
 * 1. **What is displayed is what devices resolve, never what was written.**
 *    Every state transition comes from a READ; the write's own echo is kept
 *    separately (`lastWrite`) so the two can be compared rather than conflated.
 * 2. **A failed read-back is UNKNOWN.** The last known-good value stays on
 *    screen and the error is surfaced.
 *
 * What is specific to THIS domain:
 *
 * **"No row" is `auto`, and getting that wrong ships the feature dark.** Coord
 * answers `effective_level: "off"` both for "nobody ever wrote a row" and for
 * "an operator turned it off". D6 spends a warning block on this: an
 * unregistered domain resolves `off` for every tenant, so publications would
 * land and nothing would ever fan out, with no error anywhere. The default for
 * a tenant that has never touched this dial is `auto`, and `isDefaulted` says
 * which case produced the displayed level so the control can label it rather
 * than imply an operator chose it.
 *
 * **An unparseable level is `off`, not the default** — the same asymmetry
 * `policy_write` has, sharpened by what this dial authorises. "Nobody ruled"
 * and "somebody ruled unreadably" are different facts, and the second one is
 * about coord writing a body into this tenant from another tenant's
 * publication. An authority setting coord cannot read is not permission to do
 * that.
 */
export function usePolicyUpstreamPolicy() {
  // Read, write and read-back — with the refresh-vs-write race guard — are
  // the shared tenant-band dial's; this hook adds only the domain's level
  // vocabulary below.
  const dial = useTenantFleetPolicyDial<PolicyUpstreamLevel>(
    POLICY_UPSTREAM_DOMAIN,
    "upstream policy updates"
  );
  const { policy } = dial;

  // `"none"` means no row matched, which for this domain is `auto` — NOT off.
  // Mirrors coord's `resolve_policy_upstream_level`; if the two ever disagree
  // the console misreports the fleet.
  const isDefaulted = policy?.resolved_scope === "none";

  // A row exists but its level is not in the vocabulary. Resolve it the most
  // restrictive way and keep the raw string so the UI can name the row to fix,
  // rather than presenting `off` as an operator's choice.
  const unrecognizedLevel: string | null =
    policy && !isDefaulted && !isPolicyUpstreamLevel(policy.effective_level)
      ? policy.effective_level
      : null;

  // Calls the guard again rather than branching on `unrecognizedLevel`, so the
  // narrowing is TypeScript's own and no cast is needed.
  const displayLevel: PolicyUpstreamLevel | null = !policy
    ? null
    : isDefaulted
      ? POLICY_UPSTREAM_DEFAULT_LEVEL
      : isPolicyUpstreamLevel(policy.effective_level)
        ? policy.effective_level
        : POLICY_UPSTREAM_FAIL_CLOSED_LEVEL;

  return {
    ...dial,
    /**
     * The level actually in force: the no-row case resolved to coord's typed
     * default, an unparseable row resolved fail-closed. Always one of the three
     * known levels, or `null` before the first read. Prefer this over
     * `policy.effective_level` in the UI.
     */
    displayLevel,
    /** True when no row exists, so `displayLevel` is coord's typed default. */
    isDefaulted,
    /**
     * The raw level string coord returned when it is NOT one this console
     * knows. `displayLevel` has already been resolved fail-closed; this exists
     * so the UI can name the row that needs fixing.
     */
    unrecognizedLevel,
  };
}
