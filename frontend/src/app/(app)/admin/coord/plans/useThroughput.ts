"use client";

/**
 * coord's throughput aggregate over a date range — read, never reduced.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 4.
 * The range is the question: changing it discards the previous answer before
 * the new one lands, so a 30-day chart is never shown under a 90-day label.
 * A failed refresh of the SAME range keeps the last answer (it is still the
 * answer to the question on screen); a failed first read is UNKNOWN, and a
 * 404 says the backend does not serve the route at all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { isNotFoundError } from "@/components/console";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  deriveThroughput,
  sinceForRange,
  type ThroughputReading,
} from "./throughput";

export const THROUGHPUT_ENDPOINT = "/api/v1/operations/plans/throughput";

export function useThroughput(days: number): {
  reading: ThroughputReading;
  refresh: () => Promise<void>;
} {
  const [reading, setReading] = useState<ThroughputReading>({
    state: "pending",
  });
  const reqId = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const id = ++reqId.current;
    const qs = new URLSearchParams({ since: sinceForRange(days) });
    try {
      const body = await httpClient.get<unknown>(
        `${THROUGHPUT_ENDPOINT}?${qs.toString()}`,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!mounted.current || id !== reqId.current) return;
      setReading(deriveThroughput(body));
    } catch (e) {
      if (!mounted.current || id !== reqId.current) return;
      const reason = e instanceof Error ? e.message : String(e);
      const notServed = isNotFoundError(e);
      setReading((prev) =>
        prev.state === "loaded" || prev.state === "empty"
          ? prev
          : { state: "failed", reason, notServed }
      );
    }
  }, [days]);

  useEffect(() => {
    mounted.current = true;
    // A new range is a new question: the old answer is not an answer to it.
    setReading({ state: "pending" });
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { reading, refresh };
}
