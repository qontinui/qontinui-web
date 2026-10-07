"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  RESUME_UNFINISHED_API,
  type ResumeUnfinishedView,
  type ResumeUnfinishedWriteResult,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The tenant's `resume_unfinished_enabled` flag.
 *
 * Same honesty properties as `useTranscriptSyncPolicy`: what is shown comes
 * from a READ (the GET or coord's post-write re-read), never the value we
 * asked for; a failed read keeps the last confirmed value and never resolves
 * to ON; a read begun before a landed write is discarded.
 */
export function useResumeUnfinishedPolicy() {
  const [policy, setPolicy] = useState<ResumeUnfinishedView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readbackError, setReadbackError] = useState<string | null>(null);
  const writeGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view = await httpClient.get<ResumeUnfinishedView>(
        RESUME_UNFINISHED_API
      );
      if (generation !== writeGeneration.current) return;
      setPolicy(view);
      setError(null);
      setReadbackError(null);
    } catch (err) {
      if (generation !== writeGeneration.current) return;
      setError(message(err, "Failed to read the automatic-resume setting"));
    } finally {
      if (generation === writeGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const supersedeReads = useCallback(() => {
    writeGeneration.current += 1;
    setLoading(false);
  }, []);

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      try {
        setSaving(true);
        const result = await httpClient.patch<ResumeUnfinishedWriteResult>(
          RESUME_UNFINISHED_API,
          { resume_unfinished_enabled: enabled }
        );
        supersedeReads();
        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          setReadbackError(null);
          if (result.effective.resume_unfinished_enabled === enabled) {
            toast.success(
              `Automatic resume is now ${enabled ? "on" : "off"} for this tenant.`
            );
          } else {
            toast.warning(
              `Wrote ${enabled ? "on" : "off"}, but coord reads it back as ` +
                `${String(result.effective.resume_unfinished_enabled)}.`
            );
          }
        } else {
          setReadbackError(result.readback_error ?? "read-back missing");
          toast.warning(
            "The write went through, but coord did not return what it now enforces — refresh to check."
          );
        }
        return true;
      } catch (err) {
        const text = message(
          err,
          "Failed to write the automatic-resume setting"
        );
        // 504 = coord's answer was lost in transit: it may have committed.
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
