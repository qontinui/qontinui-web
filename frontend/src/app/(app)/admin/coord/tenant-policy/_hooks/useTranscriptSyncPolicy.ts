"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  TRANSCRIPT_SYNC_API,
  type TranscriptSyncView,
  type TranscriptSyncWriteResult,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The tenant's transcript-sync consent — read what coord enforces, write a new
 * value, and show coord's own read-back.
 *
 * Same honesty properties as `useTenantFleetPolicyDial` (which this cannot
 * reuse: the flag lives in `coord.tenant_policies`, not the fleet-policy
 * store, and is a boolean rather than a level):
 *
 * 1. What is displayed comes from a READ — the GET, or coord's post-write
 *    re-read — never from the value we asked for.
 * 2. A write whose read-back coord did not return keeps the last confirmed
 *    value and surfaces `readbackError`. A failed read likewise keeps the last
 *    known-good value rather than blanking it into something that renders as
 *    "off".
 * 3. A read that started before a landed write is discarded when it resolves,
 *    so a slow Refresh cannot paint the pre-write value over the confirmed one.
 */
export function useTranscriptSyncPolicy() {
  const [policy, setPolicy] = useState<TranscriptSyncView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readbackError, setReadbackError] = useState<string | null>(null);
  const writeGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view =
        await httpClient.get<TranscriptSyncView>(TRANSCRIPT_SYNC_API);
      if (generation !== writeGeneration.current) return;
      setPolicy(view);
      setError(null);
      setReadbackError(null);
    } catch (err) {
      if (generation !== writeGeneration.current) return;
      setError(message(err, "Failed to read the transcript sync setting"));
    } finally {
      // A discarded read must not clear the spinner of a newer one; a write
      // that superseded it clears loading itself (`supersedeReads`).
      if (generation === writeGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Retire every read that began before a write that (may have) landed. */
  const supersedeReads = useCallback(() => {
    writeGeneration.current += 1;
    setLoading(false);
  }, []);

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      try {
        setSaving(true);
        const result = await httpClient.patch<TranscriptSyncWriteResult>(
          TRANSCRIPT_SYNC_API,
          { transcript_sync_enabled: enabled }
        );
        supersedeReads();
        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          setReadbackError(null);
          if (result.effective.transcript_sync_enabled === enabled) {
            toast.success(
              `Transcript sync is now ${enabled ? "on" : "off"} for this tenant.`
            );
          } else {
            toast.warning(
              `Wrote ${enabled ? "on" : "off"}, but coord reads it back as ` +
                `${String(result.effective.transcript_sync_enabled)}.`
            );
          }
        } else {
          setReadbackError(result.readback_error ?? "read-back missing");
          toast.warning(
            "The write went through, but coord did not return what it now " +
              "enforces — refresh to check."
          );
        }
        return true;
      } catch (err) {
        const text = message(
          err,
          "Failed to write the transcript sync setting"
        );
        // The backend answers 504 when coord's answer was lost in transit (a
        // timeout, a cut connection): coord may well have committed. That is
        // UNKNOWN, not "failed" — reporting it as a failure would tell the
        // operator nothing changed when the flag may already have flipped.
        if (/ failed: 504\b/.test(text)) {
          supersedeReads();
          setReadbackError(
            "coord's answer was lost in transit, so whether it applied is unknown"
          );
          toast.warning(
            "The write may or may not have been applied — refresh to check."
          );
          return false;
        }
        toast.error(text);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [supersedeReads]
  );

  return {
    policy,
    loading,
    saving,
    error,
    readbackError,
    reload: load,
    setEnabled,
  };
}
