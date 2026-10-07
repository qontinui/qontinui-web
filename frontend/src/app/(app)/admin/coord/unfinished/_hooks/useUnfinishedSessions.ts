"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  UNFINISHED_API,
  type UnfinishedSession,
  type UnfinishedSessionsView,
} from "../types";
import { resumeAccount, resumeBlockedReason } from "../_lib/unfinished";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The fleet-wide unfinished-sessions read plus the two per-row actions.
 *
 * * `view.state === "unknown"` is surfaced as-is — `sessions` is `null` there
 *   and the page renders UNKNOWN, never "nothing unfinished".
 * * A failed re-read keeps the last good view (stale) and sets `error`; it
 *   never blanks the list into something that reads as empty.
 * * A mutation re-reads afterwards instead of editing the list locally, so
 *   what is shown is always coord's answer.
 */
export function useUnfinishedSessions() {
  const [view, setView] = useState<UnfinishedSessionsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      setLoading(true);
      const next = await httpClient.get<UnfinishedSessionsView>(UNFINISHED_API);
      if (mine !== generation.current) return;
      setView(next);
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(message(err, "Failed to read unfinished sessions"));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismiss = useCallback(
    async (row: UnfinishedSession): Promise<boolean> => {
      setBusyId(row.claude_session_id);
      try {
        await httpClient.post(
          `${UNFINISHED_API}/${row.claude_session_id}/dismiss`,
          {}
        );
        toast.success("Dismissed — the session is marked finished.");
        await load();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to dismiss the session"));
        // A lost/ambiguous answer may still have applied: re-read.
        await load();
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const resume = useCallback(
    async (row: UnfinishedSession): Promise<boolean> => {
      const account = resumeAccount(row);
      if (resumeBlockedReason(row) !== null || account === null) return false;
      setBusyId(row.claude_session_id);
      try {
        await httpClient.post(
          `${UNFINISHED_API}/${row.coord_session_id}/resume`,
          {
            target_device_id: row.device_id,
            account,
          }
        );
        toast.success(
          "Resume requested — the device will pick it up; this row clears once a child session exists."
        );
        await load();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to request the resume"));
        await load();
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  return { view, loading, error, busyId, reload: load, dismiss, resume };
}
