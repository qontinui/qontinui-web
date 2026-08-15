"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  PLAN_CAPTURE_DOMAIN,
  type FleetPolicyView,
  type FleetPolicyWriteResult,
  type PlanCaptureLevel,
} from "../types";

const API = "/api/v1/operations/fleet-policy";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The `plan_capture` fleet-policy toggle — read the RESOLVED value, write a new
 * level, then read it back.
 *
 * Three properties this hook exists to hold:
 *
 * 1. **What is displayed is what devices resolve, never what was written.**
 *    Coord folds `master_enabled` in and lets a more specific scope band win,
 *    so a successful write does not entail the value the fleet sees. Every
 *    state transition here comes from a READ (`policy`), and the write's own
 *    echo is kept separately (`lastWrite`) so the two can be compared rather
 *    than conflated.
 *
 * 2. **A failed read-back is UNKNOWN.** When the backend reports
 *    `readback_error`, this does NOT optimistically set the new level — it
 *    keeps the last known-good value and surfaces `readbackError`. Painting
 *    the written level on an unconfirmed write is exactly how a toggle starts
 *    lying about the fleet.
 *
 * 3. **Scope band is tenant-wide, and that is a decision, not a default.** The
 *    clause this toggle gates is baked into a runner's briefing once per
 *    session at spawn time, and a session is not repo-scoped — a `repo` band
 *    would have no resolvable `scope_key` at the moment the decision is made.
 *    So the hook offers no per-repo write. It still SHOWS the resolved band,
 *    because the band that won tells the operator whether this tenant's row is
 *    the one in force.
 *
 * Coord resolves **most-specific-wins**: `repo` beats `tenant` beats `system`
 * (`resolve_effective` picks the lowest `ScopeBand` ordinal, Repo=0 < Tenant=1
 * < System=2). So a `repo` band winning means a narrower row is overriding the
 * tenant row, while a `system` band winning means this tenant has NO row at all
 * — writing one here will take effect. Getting that backwards would tell the
 * operator a write is futile in precisely the case where it wins.
 */
export function usePlanCapturePolicy() {
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
        `${API}?domain=${encodeURIComponent(PLAN_CAPTURE_DOMAIN)}`
      );
      setPolicy(view);
      setError(null);
      // A confirmed read retires the previous write's read-back failure. The
      // banner it drives says "the value above may be stale" — leaving it up
      // beside a value we just confirmed would be the opposite of honest.
      setLastWrite(null);
    } catch (err) {
      // Keep the last known-good value on screen; the banner says it is stale.
      // Blanking it would read as "off", which is a claim we cannot make.
      setError(message(err, "Failed to read the capture policy"));
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
   * `master_enabled` is always `true`: coord resolves `effective_level = off`
   * whenever the master is false, so a two-state toggle that also flipped the
   * master would have two different spellings of "off" and no way for the
   * operator to tell which one is in force. The level alone carries the state.
   */
  const setLevel = useCallback(
    async (level: PlanCaptureLevel, changeNote?: string): Promise<boolean> => {
      try {
        setSaving(true);
        const result = await httpClient.put<FleetPolicyWriteResult>(API, {
          domain: PLAN_CAPTURE_DOMAIN,
          scope_band: "tenant",
          scope_key: null,
          level,
          master_enabled: true,
          change_note:
            changeNote ?? `Set plan capture to "${level}" from the console`,
        });
        setLastWrite(result);

        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          if (result.effective.effective_level === level) {
            toast.success(`Plan capture is now "${level}" for this tenant.`);
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
          // Written, but unconfirmed. Leave `policy` alone — do NOT paint the
          // written level as though it were resolved.
          toast.warning(
            "The write went through, but the read-back failed — what devices " +
              "resolve is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to write the capture policy"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    policy,
    loading,
    saving,
    error,
    /** Set only when the last write's read-back failed. UNKNOWN, not "off". */
    readbackError: lastWrite?.readback_error ?? null,
    lastWrite,
    reload: load,
    setLevel,
  };
}
