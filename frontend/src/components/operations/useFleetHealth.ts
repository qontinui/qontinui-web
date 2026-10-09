"use client";

/**
 * `useFleetHealth` — the 10 s foreground poll of coord's device liveness read,
 * `GET /api/v1/operations/fleet/health`.
 *
 * Lifted out of `admin/coord/fleet/page.tsx` (where it was a page-local
 * `useFleetHealth`) by plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1: the Dev Ops
 * Overview is the surface that OWNS this read now, and a hook declared inside
 * one page cannot be imported by another.
 *
 * The request itself, and the wire shapes it serves, live in the typed
 * `/operations` client, `@/lib/api/operations/coordFleet` (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 6): this hook, `CoordNav`'s `useFleetAlarmBadge`, the conditions
 * runner hint and the spawn modal's device roster all read through its one
 * `fetchFleetHealth`, so there is one `/fleet/health` reader, not four.
 */

import { useCallback, useState } from "react";
import {
  fetchFleetHealth,
  type FleetHealthDevice,
  type FleetHealthPayload,
} from "@/lib/api/operations/coordFleet";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

/**
 * Poll cadence. Coord's device prober runs far slower than this; 10 s is the
 * foreground cadence for a page whose whole job is machine liveness.
 */
export const FLEET_HEALTH_POLL_MS = 10_000;

/**
 * Whether coord says this device carries the `ci_runner` capability. Read off
 * coord's own device read rather than the CI-runner mirror, so a mirror poll
 * that is loading or has failed cannot reclassify the machine.
 */
export function isCiRunnerDevice(device: FleetHealthDevice): boolean {
  return typeof device.ci_runner_status === "string";
}

export interface UseFleetHealthResult {
  data: FleetHealthPayload | null;
  loading: boolean;
  /**
   * Transport failure. `data` is deliberately NOT cleared: a failed read is
   * evidence about the network, not about the fleet, and emptying the list
   * would assert "no machines" on no evidence.
   */
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFleetHealth(): UseFleetHealthResult {
  const [data, setData] = useState<FleetHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5): a
  // coord-proxied poll that fails is retried by its next tick, never by
  // `httpClient`'s 5xx backoff chain, and never overlaps itself.
  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await fetchFleetHealth(COORD_DASHBOARD_POLL_OPTIONS);
      if (!isCurrent()) return;
      setData(body);
      setError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(describeCoordPollError(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_HEALTH_POLL_MS);

  return { data, loading, error, refresh };
}
