"use client";

/**
 * `GET /overview/schedule` (`fetchSchedule`) — the project's phases,
 * milestones and decision gates as coord holds them.
 *
 * Polls no faster than the server's 60 s cache (`SCHEDULE_POLL_MS`),
 * single-flight, and a failed read KEEPS the previous envelope: a failed read
 * is evidence about the network, not about the schedule, so the page keeps the
 * last answer (with its own `observed_at`) and says the refresh failed rather
 * than clearing to nothing. A project change drops the retained envelope
 * first, so one project's phases are never shown under another's name.
 */

import { useCallback, useState } from "react";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  SCHEDULE_POLL_MS,
  fetchSchedule,
  isScheduleEnvelope,
  type ScheduleEnvelope,
} from "../_lib/schedule-api";

export interface UseScheduleResult {
  data: ScheduleEnvelope | null;
  loading: boolean;
  /** Transport failure; `data` is kept. */
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSchedule(
  tenantId: string | null,
  hold: boolean
): UseScheduleResult {
  const [data, setData] = useState<ScheduleEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataTenant, setDataTenant] = useState<string | null>(tenantId);
  if (dataTenant !== tenantId) {
    setDataTenant(tenantId);
    setData(null);
    setError(null);
    setLoading(true);
  }

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      if (hold) return;
      try {
        const body = await fetchSchedule();
        if (!isCurrent()) return;
        if (!isScheduleEnvelope(body)) {
          setError("the service answered without a schedule");
          return;
        }
        setData(body);
        setError(null);
      } catch (e) {
        if (!isCurrent()) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    // `tenantId` names the active-tenant header the request carries, so a new
    // `poll` identity is what makes the poll re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantId, hold]
  );

  const { refresh } = useSingleFlightPoll(poll, SCHEDULE_POLL_MS, {
    supersedeOnChange: true,
  });

  return { data, loading, error, refresh };
}
