"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  FLEET_POLICY_API,
  type FleetPolicyView,
  type FleetPolicyWriteResult,
} from "../../_shared/fleetPolicy";
import {
  isPolicyUpstreamLevel,
  POLICY_UPSTREAM_DEFAULT_LEVEL,
  POLICY_UPSTREAM_DOMAIN,
  POLICY_UPSTREAM_FAIL_CLOSED_LEVEL,
  type PolicyUpstreamLevel,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The `policy_upstream` fleet-policy dial — what happens to this tenant when
 * the fleet publishes a new version of a document it holds.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing` D6.
 *
 * Modelled on `usePolicyWritePolicy` in this same directory, and it keeps that
 * hook's two load-bearing properties for the reasons stated there:
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
  const [policy, setPolicy] = useState<FleetPolicyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<FleetPolicyWriteResult | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const view = await httpClient.get<FleetPolicyView>(
        `${FLEET_POLICY_API}?domain=${encodeURIComponent(
          POLICY_UPSTREAM_DOMAIN
        )}`
      );
      setPolicy(view);
      setError(null);
      // A confirmed read retires the previous write's read-back failure — its
      // banner says "the value above may be stale", and leaving it up beside a
      // value we just confirmed would be the opposite of honest.
      setLastWrite(null);
    } catch (err) {
      // Keep the last known-good value on screen; the banner says it is stale.
      // Blanking it would read as "off", which is a claim we cannot make.
      setError(message(err, "Failed to read the upstream-updates dial"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Write `level` at the tenant band.
   *
   * `master_enabled` stays `true` and `off` is expressed as a LEVEL, for the
   * reason the sibling dials give: coord resolves `effective_level = off`
   * whenever the master is false, so also flipping the master would give "off"
   * two spellings with no way for the operator to tell which is in force.
   */
  const setLevel = useCallback(
    async (
      level: PolicyUpstreamLevel,
      changeNote?: string
    ): Promise<boolean> => {
      try {
        setSaving(true);
        const result = await httpClient.put<FleetPolicyWriteResult>(
          FLEET_POLICY_API,
          {
            domain: POLICY_UPSTREAM_DOMAIN,
            scope_band: "tenant",
            scope_key: null,
            level,
            master_enabled: true,
            change_note:
              changeNote ??
              `Set upstream policy updates to "${level}" from the console`,
          }
        );
        setLastWrite(result);

        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          if (result.effective.effective_level === level) {
            toast.success(`Upstream policy updates are now "${level}".`);
          } else {
            // A write that landed and a value that resolves are different
            // facts. Say which one the fleet is actually on.
            toast.warning(
              `Wrote "${level}", but devices resolve ` +
                `"${result.effective.effective_level}" ` +
                `(from the ${result.effective.resolved_scope} scope).`
            );
          }
        } else {
          toast.warning(
            "The write went through, but the read-back failed — what this " +
              "tenant resolves is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to write the upstream-updates dial"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

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
    policy,
    loading,
    saving,
    error,
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
    /** Set only when the last write's read-back failed. UNKNOWN, not "off". */
    readbackError: lastWrite?.readback_error ?? null,
    lastWrite,
    reload: load,
    setLevel,
  };
}
