"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchTenantSettings,
  patchTenantAutoFixPr,
  type EffectiveProfile,
} from "@/lib/api/operations/prMerge";
import {
  type AutoFixPrChoice,
  type AutoFixPrState,
  isUnconfirmedWrite,
  readAutoFixPr,
  tenantFromChoice,
} from "./auto-fix-pr";

/** How a re-read of the merge settings ended. */
export type AutoFixPrReread = { ok: true } | { ok: false; error: string };

/**
 * What a dial write did, as far as coord said. The caller shows coord's
 * answer, never the value it asked for, so it needs to know which of these
 * it got:
 *
 * - `saved` — coord's PATCH answer READ BACK the value sent; the hook now
 *   holds that answer.
 * - `refused` — a definite failure (a 4xx, an explicit `written: false`, a
 *   502 before anything was sent): nothing changed as far as coord said, and
 *   the hook keeps what it read before.
 * - `unconfirmed` — whether the write landed is unknown: coord could not
 *   confirm its commit (`written: null`), the request timed out after it may
 *   have been processed, or a 2xx answer did not read back the value sent.
 *   The hook re-reads what coord serves, and `reread` settles when that read
 *   does — until then the dial's value is UNKNOWN.
 * - `busy` — another write from this hook was still in flight; nothing was
 *   sent.
 */
export type AutoFixPrWriteOutcome =
  | { kind: "saved" }
  | { kind: "refused"; message: string }
  | { kind: "unconfirmed"; reason: string; reread: Promise<AutoFixPrReread> }
  | { kind: "busy" };

export interface UseAutoFixPrSettingReturn {
  loading: boolean;
  saving: boolean;
  /** Load failure message — the dial is then UNKNOWN, never on. */
  error: string | null;
  /** `null` when loaded but the coord build does not serve the fields. */
  state: AutoFixPrState | null;
  /**
   * The tenant-level merge profile the dial was read from — the same read,
   * for a caller that shows another of its fields. `null` before the first
   * answer and after a failed read (UNKNOWN, never a stale profile).
   */
  profile: EffectiveProfile | null;
  setChoice: (choice: AutoFixPrChoice) => Promise<AutoFixPrWriteOutcome>;
  /** Re-read the merge settings; settles when that read (or a newer one) does. */
  reload: () => Promise<AutoFixPrReread>;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Loads and writes the tenant `auto_fix_pr` dial through the existing
 * pr-merge settings proxy. The dial writes on click rather than joining the
 * page's Save button: it is a different endpoint and a different table from
 * the next-step autonomy draft, and a Save that silently covered both would
 * blur which write failed.
 *
 * A write counts as saved only when coord's response READS BACK the value that
 * was sent. A 2xx whose profile lacks the dial, or carries a different tenant
 * value, is an unconfirmed write and is reported as one.
 *
 * Every answer — a load, or a write's own answer — is ordered by one ticket
 * counter: a load issued before a write resolved cannot paint the pre-write
 * value over the write's answer, and of two loads only the newer applies.
 */
export function useAutoFixPrSetting(): UseAutoFixPrSettingReturn {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AutoFixPrState | null>(null);
  const [profile, setProfile] = useState<EffectiveProfile | null>(null);
  const savingRef = useRef(false);
  /** The newest ticket issued; only an answer holding it may apply. */
  const ticket = useRef(0);
  /** The newest load, which a superseded load's caller waits for instead. */
  const latestLoad = useRef<Promise<AutoFixPrReread> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readOnce = useCallback(async (t: number): Promise<AutoFixPrReread> => {
    const current = (n: number) => mounted.current && n === ticket.current;
    try {
      const data = await fetchTenantSettings();
      if (current(t)) {
        setState(readAutoFixPr(data?.profile));
        setProfile(data?.profile ?? null);
      }
      return { ok: true };
    } catch (err) {
      const message = errorText(err, "Failed to load merge settings");
      if (current(t)) {
        setState(null);
        setProfile(null);
        setError(message);
      }
      return { ok: false, error: message };
    } finally {
      if (current(t)) setLoading(false);
    }
  }, []);

  const load = useCallback(async (): Promise<AutoFixPrReread> => {
    ticket.current += 1;
    const t = ticket.current;
    setLoading(true);
    setError(null);
    const own = readOnce(t);
    latestLoad.current = own;
    const result = await own;
    // A newer load superseded this one before it answered: what will be on
    // screen is that load's answer, so its caller waits for it too.
    const latest = latestLoad.current;
    if (t !== ticket.current && latest !== null && latest !== own) {
      return latest;
    }
    return result;
  }, [readOnce]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => load(), [load]);

  const setChoice = useCallback(
    async (choice: AutoFixPrChoice): Promise<AutoFixPrWriteOutcome> => {
      // One write at a time: a second click while a PATCH is in flight is
      // dropped rather than racing the first to a last-writer-wins result.
      if (savingRef.current) return { kind: "busy" };
      savingRef.current = true;
      setSaving(true);
      const sent = tenantFromChoice(choice);
      try {
        const data = await patchTenantAutoFixPr(sent);
        const next = readAutoFixPr(data?.profile);
        if (next === null || next.tenant !== sent) {
          toast.error(
            "Coord accepted the request but did not confirm the fixer setting — reloading."
          );
          return {
            kind: "unconfirmed",
            reason: "coord's answer did not read back the value sent",
            reread: load(),
          };
        }
        // Coord's answer after the write: it outranks any load still in
        // flight, which was issued before the write resolved.
        ticket.current += 1;
        setState(next);
        setProfile(data.profile);
        setError(null);
        setLoading(false);
        toast.success("Fixer session setting saved");
        return { kind: "saved" };
      } catch (err) {
        const message = errorText(err, "Failed to save fixer setting");
        if (isUnconfirmedWrite(message)) {
          // coord could not confirm the commit, or the request timed out after
          // it may have been processed. Neither "saved" nor "safe to retry":
          // show what coord actually serves now.
          toast.error(
            "Save outcome unknown — the change may or may not have been applied. Reloading to check."
          );
          return { kind: "unconfirmed", reason: message, reread: load() };
        }
        toast.error(message);
        return { kind: "refused", message };
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [load]
  );

  return { loading, saving, error, state, profile, setChoice, reload };
}
