"use client";

/**
 * How many sessions each machine has open now — coord's session run record
 * (`GET /coord/session-runs/concurrency`, `open_now`), through the web
 * backend's existing passthrough and the session-load page's own client and
 * reader (`fetchSessionRunConcurrency`, `readConcurrency`). **Never call
 * coord from the browser.**
 *
 * One read of the last 24 hours at 15-minute buckets (session-load's own
 * 24-hour spec), polled single-flight with no retries. A failed read keeps the
 * last good body, labelled stale — except the answers about the data itself
 * (the record is not deployed, the caller may not read it), which clear it
 * (`issueClearsRetained`, session-load's rule).
 */

import { useCallback, useState } from "react";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import { fetchSessionRunConcurrency } from "@/lib/api/operations/coordSessionRuns";
import {
  classifySessionLoadError,
  issueClearsRetained,
  readConcurrency,
  sessionLoadWindowSpec,
} from "@/app/(app)/admin/coord/session-load/_lib/sessionLoadStatus";
import type { SessionsRead } from "./machineStatus";

/** The window the per-machine session count is read over. */
export const SESSIONS_WINDOW = sessionLoadWindowSpec("24h");

/** Sessions move with sessions, not a sampler; a minute matches session load. */
export const SESSIONS_POLL_MS = 60_000;

export interface SessionConcurrencyRead extends SessionsRead {
  /** coord's own `as_of` on the last good body, or `null`. */
  asOf: string | null;
  refresh: () => Promise<void> | void;
}

export function useSessionConcurrency(): SessionConcurrencyRead {
  const [state, setState] = useState<SessionsRead>({ data: null, issue: null });

  const poll = useCallback(async (isCurrent: () => boolean) => {
    let next: (prev: SessionsRead) => SessionsRead;
    try {
      const body = await fetchSessionRunConcurrency(
        "24h",
        SESSIONS_WINDOW.bucket,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      const reading = readConcurrency(body, SESSIONS_WINDOW.seconds);
      next =
        reading.kind === "ok"
          ? () => ({ data: reading.body, issue: null })
          : (prev) => ({
              data: issueClearsRetained(reading.issue) ? null : prev.data,
              issue: reading.issue,
            });
    } catch (err) {
      const issue = classifySessionLoadError(err);
      next = (prev) => ({
        data: issueClearsRetained(issue) ? null : prev.data,
        issue,
      });
    }
    if (!isCurrent()) return;
    setState(next);
  }, []);

  const { refresh } = useSingleFlightPoll(poll, SESSIONS_POLL_MS);
  return { ...state, asOf: state.data?.as_of ?? null, refresh };
}
