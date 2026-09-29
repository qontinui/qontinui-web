"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  FLEET_POLICY_API,
  type FleetPolicyView,
  type FleetPolicyWriteResult,
} from "./fleetPolicy";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One tenant-band fleet-policy dial — read the RESOLVED value, write a new
 * level, then read it back. Shared by every tenant-band dial in the console
 * (`plan_capture` and `citation_scope_backfill_write` on the plan library;
 * `policy_write` and `policy_upstream` on prompt documents). Each domain's
 * hook binds `domain` + `label` and layers its own level vocabulary on top
 * (a no-row default, a fail-closed parse), so the honesty properties below are
 * stated and tested once rather than drifting between copies — the four used
 * to be hand-copied, and the refresh-vs-write race fix reached only two.
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
 *    lying about the fleet. A failed READ likewise keeps the last known-good
 *    value: blanking it would render as "off", a claim we cannot make.
 *
 * 3. **Scope band is tenant-wide, and that is a decision, not a default.** Every
 *    dial bound here is decided with no repo in hand: the capture clause is
 *    baked into a runner's briefing once per session at spawn (a session is
 *    not repo-scoped), the citation backfill agent door operates on the
 *    caller's whole tenant, and `policy_write` / `policy_upstream` govern the
 *    tenant's prompt documents, which belong to no repo. A `repo` band would
 *    have no resolvable `scope_key` at the moment any of those decisions is
 *    made, so the hook offers no per-repo write. It still SHOWS the resolved band, because the band that won tells
 *    the operator whether this tenant's row is the one in force.
 *
 * Coord resolves **most-specific-wins**: `repo` beats `tenant` beats `system`
 * (`resolve_effective` picks the lowest `ScopeBand` ordinal, Repo=0 < Tenant=1
 * < System=2). So a `repo` band winning means a narrower row is overriding the
 * tenant row, while a `system` band winning means this tenant has NO row at all
 * — writing one here will take effect. Getting that backwards would tell the
 * operator a write is futile in precisely the case where it wins.
 *
 * @param domain  the fleet-policy domain coord stores the row under.
 * @param label   lower-case human name for toasts and the change note
 *                ("plan capture").
 * @param subject who resolves the level, for the disagreement toast —
 *                "devices" for a briefing clause, "agents" for an agent door.
 */
export function useTenantFleetPolicyDial<L extends string>(
  domain: string,
  label: string,
  subject: string = "devices"
) {
  const [policy, setPolicy] = useState<FleetPolicyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<FleetPolicyWriteResult | null>(
    null
  );
  // Bumped when a write LANDS. A read that began before the latest landed
  // write may resolve after that write's read-back; applying it would paint an
  // older value over the confirmed one and clear the read-back warning. A
  // rejected write changes nothing, so it does not bump — otherwise a Refresh
  // in flight beside it would be silently discarded.
  const writeGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view = await httpClient.get<FleetPolicyView>(
        `${FLEET_POLICY_API}?domain=${encodeURIComponent(domain)}`
      );
      if (generation !== writeGeneration.current) return;
      setPolicy(view);
      setError(null);
      // A confirmed read retires the previous write's read-back failure. The
      // banner it drives says "the value above may be stale" — leaving it up
      // beside a value we just confirmed would be the opposite of honest.
      setLastWrite(null);
    } catch (err) {
      if (generation !== writeGeneration.current) return;
      // Keep the last known-good value on screen; the banner says it is stale.
      // Blanking it would read as "off", which is a claim we cannot make.
      setError(message(err, `Failed to read the ${label} dial`));
    } finally {
      setLoading(false);
    }
  }, [domain, label]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Write `level` at the tenant band.
   *
   * `master_enabled` is always `true`: coord resolves `effective_level = off`
   * whenever the master is false, so a control that also flipped the master
   * would have two different spellings of "off" and no way for the operator
   * to tell which one is in force. The level alone carries the state.
   */
  const setLevel = useCallback(
    async (level: L, changeNote?: string): Promise<boolean> => {
      try {
        setSaving(true);
        const result = await httpClient.put<FleetPolicyWriteResult>(
          FLEET_POLICY_API,
          {
            domain,
            scope_band: "tenant",
            scope_key: null,
            level,
            master_enabled: true,
            change_note:
              changeNote ?? `Set ${label} to "${level}" from the console`,
          }
        );
        writeGeneration.current += 1;
        setLastWrite(result);

        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          if (result.effective.effective_level === level) {
            toast.success(
              `${capitalise(label)}: now "${level}" for this tenant.`
            );
          } else {
            // A write that landed and a value that resolves are different
            // facts. Say which one the fleet is actually on.
            toast.warning(
              `Wrote "${level}", but ${subject} resolve ` +
                `"${result.effective.effective_level}" ` +
                `(from the ${result.effective.resolved_scope} scope).`
            );
          }
        } else {
          // Written, but unconfirmed. Leave `policy` alone — do NOT paint the
          // written level as though it were resolved.
          toast.warning(
            `The write went through, but the read-back failed — what ${subject} ` +
              "resolve is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        toast.error(message(err, `Failed to write the ${label} dial`));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [domain, label, subject]
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
