"use client";

/**
 * Polling hook for the pressure-stops table (plan
 * `2026-11-24-pressure-stops-record-box-stats-in-coord` Phase 4).
 *
 * Transport: the authenticated REST proxy
 * `GET /api/v1/operations/fleet/resource-stops`, which forwards the operator
 * bearer to coord's `GET /coord/devices/resource-stops` and keeps tenant
 * scoping server-side. **Never call coord from the browser** — see
 * `useFleetResourceSamples` for the empty-tile incident that rule records.
 *
 * Single-flight, no retries (`COORD_DASHBOARD_POLL_OPTIONS`): the next tick is
 * the retry. The cadence is the resource-sample poll's — stops are events, not
 * a gauge, but a table that lags a refusal by a minute is still current for the
 * question it answers ("what was the box carrying each time it said no").
 *
 * `data` is deliberately NOT cleared by a failed poll: stale beats absent, and
 * `fetchedAtMs` (stamped only on success) is what keeps an outage honest.
 */

import { useCallback, useState } from "react";
import { fetchFleetResourceStops } from "@/lib/api/operations/coordFleet";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import type { ResourceStopsResponse } from "./fleetResourceStops";
import { RESOURCE_POLL_INTERVAL_MS } from "./useFleetResourceSamples";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

/** Rows requested per read: the newest stops, enough to see a storm's shape. */
export const RESOURCE_STOPS_LIMIT = 50;

export interface UseFleetResourceStopsResult {
  data: ResourceStopsResponse | null;
  loading: boolean;
  /** Transport/proxy failure. `data` is NOT cleared. */
  error: string | null;
  /** `Date.now()` when `data` arrived, or `null` before the first success. */
  fetchedAtMs: number | null;
  refresh: () => Promise<void>;
}

export function useFleetResourceStops(): UseFleetResourceStopsResult {
  const [data, setData] = useState<ResourceStopsResponse | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await fetchFleetResourceStops(
        RESOURCE_STOPS_LIMIT,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      setData(body);
      // Stamped ONLY on success — a failed poll must not refresh the clock.
      setFetchedAtMs(Date.now());
      setError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(
        describeCoordPollError(e, {
          routeUnavailableText:
            "coord does not serve the resource-stops route yet — unknown, not 'no stops'",
        })
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, RESOURCE_POLL_INTERVAL_MS);

  return { data, loading, error, fetchedAtMs, refresh };
}
