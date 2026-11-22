"use client";

/**
 * The Capacity panel's two reads (plan
 * `2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`
 * Phase 11), each its own route and its own poll:
 *
 * - `GET /api/v1/operations/fleet/capacity` — coord's per-device capacity
 *   read, polled at the resource cadence. Coord caches one answer per tenant
 *   for 15 s, so a faster poll would read the same answer twice.
 * - `GET /api/v1/operations/fleet/capacity-model` — the D9 dial. It changes
 *   on an operator's write, so it polls slowly ({@link DIAL_POLL_INTERVAL_MS},
 *   which still shows another operator's change) and is re-read at once after
 *   a write from this page (`refreshDial`).
 *
 * Never call coord from the browser — the proxy forwards the operator bearer
 * and keeps tenant scoping server-side, like every other read on the page.
 * "Stale beats absent": a failed poll keeps the last answer and says so.
 */

import { useCallback, useState } from "react";
import {
  fetchCapacityModel,
  fetchFleetCapacity,
  type CapacityModelView,
} from "@/lib/api/operations/coordFleet";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import {
  parseCapacityModelView,
  parseFleetCapacity,
  type FleetCapacityRead,
} from "./fleetCapacity";
import { RESOURCE_POLL_INTERVAL_MS } from "./useFleetResourceSamples";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

export interface UseFleetCapacityResult {
  capacity: FleetCapacityRead | null;
  capacityError: string | null;
  /** `Date.now()` when `capacity` arrived; `null` before the first success. */
  fetchedAtMs: number | null;
  loading: boolean;
  dial: CapacityModelView | null;
  dialError: string | null;
  refresh: () => void;
  refreshDial: () => void;
}

/** The dial's cadence: an operator's write, not telemetry, moves it. */
export const DIAL_POLL_INTERVAL_MS = 60_000;

const ROUTE_UNAVAILABLE_TEXT =
  "this coord build does not serve the operator capacity read yet";

export function useFleetCapacity(): UseFleetCapacityResult {
  const [capacity, setCapacity] = useState<FleetCapacityRead | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [dial, setDial] = useState<CapacityModelView | null>(null);
  const [dialError, setDialError] = useState<string | null>(null);

  const pollCapacity = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await fetchFleetCapacity(COORD_DASHBOARD_POLL_OPTIONS);
      if (!isCurrent()) return;
      setCapacity(parseFleetCapacity(body));
      setFetchedAtMs(Date.now());
      setCapacityError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setCapacityError(
        describeCoordPollError(e, {
          routeUnavailableText: ROUTE_UNAVAILABLE_TEXT,
        })
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const readDial = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await fetchCapacityModel(COORD_DASHBOARD_POLL_OPTIONS);
      if (!isCurrent()) return;
      setDial(parseCapacityModelView(body));
      setDialError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setDialError(
        describeCoordPollError(e, {
          routeUnavailableText:
            "this backend does not serve the capacity-model dial yet",
        })
      );
    }
  }, []);

  const { refresh } = useSingleFlightPoll(
    pollCapacity,
    RESOURCE_POLL_INTERVAL_MS
  );
  const { refresh: refreshDial } = useSingleFlightPoll(
    readDial,
    DIAL_POLL_INTERVAL_MS
  );

  return {
    capacity,
    capacityError,
    fetchedAtMs,
    loading,
    dial,
    dialError,
    refresh: () => void refresh(),
    refreshDial: () => void refreshDial(),
  };
}
