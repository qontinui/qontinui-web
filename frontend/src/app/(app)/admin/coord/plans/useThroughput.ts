"use client";

/**
 * coord's throughput aggregate over a date range — read, never reduced.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 4.
 * The range is the question: changing it discards the previous answer before
 * the new one lands, so a 30-day chart is never shown under a 90-day label.
 * A failed refresh of the SAME range keeps the last answer (it is still the
 * answer to the question on screen) but is never silent: `refreshFailure`
 * carries when that held reading was taken, so the panel says "refresh
 * failed — showing reading from HH:MM". A failed first read is UNKNOWN, and a
 * 404 says the backend does not serve the route at all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPlansThroughput } from "@/lib/api/operations/coordPlans";
import { isNotFoundError } from "@/components/console";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  deriveThroughput,
  sinceForRange,
  type ThroughputReading,
} from "./throughput";

/** The newest refresh failed while an earlier reading is still shown. */
export interface ThroughputRefreshFailure {
  /** When the reading still on screen was received (ms since epoch). */
  readingAt: number;
  reason: string;
}

export function useThroughput(days: number): {
  reading: ThroughputReading;
  refreshFailure: ThroughputRefreshFailure | null;
  refresh: () => Promise<void>;
} {
  const [reading, setReading] = useState<ThroughputReading>({
    state: "pending",
  });
  const [refreshFailure, setRefreshFailure] =
    useState<ThroughputRefreshFailure | null>(null);
  /** When the reading on screen was received; null when none is held. */
  const readingAt = useRef<number | null>(null);
  const reqId = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const id = ++reqId.current;
    const qs = new URLSearchParams({ since: sinceForRange(days) });
    try {
      const body = await fetchPlansThroughput(qs, COORD_DASHBOARD_POLL_OPTIONS);
      if (!mounted.current || id !== reqId.current) return;
      const next = deriveThroughput(body);
      // Only an ANSWER is held across a later failure; an unreadable body is
      // UNKNOWN itself and a failed refresh replaces it.
      readingAt.current =
        next.state === "loaded" || next.state === "empty" ? Date.now() : null;
      setReading(next);
      setRefreshFailure(null);
    } catch (e) {
      if (!mounted.current || id !== reqId.current) return;
      const reason = e instanceof Error ? e.message : String(e);
      const notServed = isNotFoundError(e);
      const heldAt = readingAt.current;
      if (heldAt !== null) {
        // The last reading is still the answer to this range — kept, and
        // marked, so it never reads as a live one.
        setRefreshFailure({ readingAt: heldAt, reason });
        return;
      }
      setReading({ state: "failed", reason, notServed });
    }
  }, [days]);

  useEffect(() => {
    mounted.current = true;
    // A new range is a new question: the old answer is not an answer to it.
    readingAt.current = null;
    setReading({ state: "pending" });
    setRefreshFailure(null);
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { reading, refreshFailure, refresh };
}
