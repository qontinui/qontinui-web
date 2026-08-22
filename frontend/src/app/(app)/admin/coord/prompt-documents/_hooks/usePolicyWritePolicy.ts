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
  POLICY_WRITE_DEFAULT_LEVEL,
  POLICY_WRITE_DOMAIN,
  type PolicyWriteLevel,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The `policy_write` fleet-policy dial — how much of the agent policy-write
 * surface this tenant permits.
 *
 * Plan `2026-08-06-agent-policy-replace-and-write-autonomy-dial` §4.
 *
 * Modelled on `plan-library/_hooks/usePlanCapturePolicy.ts`, and it keeps that
 * hook's first and most important property:
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
 * Two things are specific to THIS domain:
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
 * **The dial is subtractive.** It never grants authority — the per-document
 * `agent_writable` control decides whether an agent may write a document at all,
 * and this dial can only narrow what happens to a write that control already
 * allowed. That is why this hook lives beside `AgentWriteAccessControl` rather
 * than on a settings page: they are two halves of one question, and the answer
 * is the more restrictive of them.
 */
export function usePolicyWritePolicy() {
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
        `${FLEET_POLICY_API}?domain=${encodeURIComponent(POLICY_WRITE_DOMAIN)}`
      );
      setPolicy(view);
      setError(null);
      // A confirmed read retires the previous write's read-back failure — the
      // banner it drives says "the value above may be stale", and leaving it up
      // beside a value we just confirmed would be the opposite of honest.
      setLastWrite(null);
    } catch (err) {
      // Keep the last known-good value on screen; the banner says it is stale.
      // Blanking it would read as "off", which is a claim we cannot make.
      setError(message(err, "Failed to read the policy-write dial"));
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
   * reason the capture toggle gives: coord resolves `effective_level = off`
   * whenever the master is false, so also flipping the master would give "off"
   * two spellings with no way for the operator to tell which is in force.
   */
  const setLevel = useCallback(
    async (level: PolicyWriteLevel, changeNote?: string): Promise<boolean> => {
      try {
        setSaving(true);
        const result = await httpClient.put<FleetPolicyWriteResult>(
          FLEET_POLICY_API,
          {
            domain: POLICY_WRITE_DOMAIN,
            scope_band: "tenant",
            scope_key: null,
            level,
            master_enabled: true,
            change_note:
              changeNote ??
              `Set agent policy-write autonomy to "${level}" from the console`,
          }
        );
        setLastWrite(result);

        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          if (result.effective.effective_level === level) {
            toast.success(`Agent policy writes are now "${level}".`);
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
            "The write went through, but the read-back failed — what devices " +
              "resolve is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to write the policy-write dial"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // `"none"` means no row matched, which for this domain is the code default —
  // NOT off. Mirrors coord's `resolve_policy_write_level`; if the two ever
  // disagree the console misreports the fleet.
  const isDefaulted = policy?.resolved_scope === "none";
  const displayLevel: string | null = policy
    ? isDefaulted
      ? POLICY_WRITE_DEFAULT_LEVEL
      : policy.effective_level
    : null;

  return {
    policy,
    loading,
    saving,
    error,
    /**
     * The level actually in force, with the no-row case resolved to the code
     * default. Prefer this over `policy.effective_level` in the UI.
     */
    displayLevel,
    /** True when no row exists, so `displayLevel` is coord's built-in default. */
    isDefaulted,
    /** Set only when the last write's read-back failed. UNKNOWN, not "off". */
    readbackError: lastWrite?.readback_error ?? null,
    lastWrite,
    reload: load,
    setLevel,
  };
}
