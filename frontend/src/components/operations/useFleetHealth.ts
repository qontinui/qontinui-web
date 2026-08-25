"use client";

/**
 * `GET /api/v1/operations/fleet/health` — coord's device liveness read, and
 * the wire shapes it serves.
 *
 * Lifted out of `admin/coord/fleet/page.tsx` (where it was a page-local
 * `useFleetHealth`) by plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1: the Dev Ops
 * Overview is the surface that OWNS this read now, and a hook declared inside
 * one page cannot be imported by another. The pipeline page keeps calling it
 * until Phase 4 moves the last consumer off that page.
 *
 * The devices this returns are the SPINE of every fleet surface built on it:
 * a device that reports health but publishes no resource sample, and a device
 * that appears in no runner inventory, must both still render — as `unknown`,
 * never as absent and never as healthy (`[policy: silent-empty-is-unknown]`).
 */

import { useCallback, useEffect, useState } from "react";
import { httpClient } from "@/services/service-factory";

/**
 * A SAME-ORIGIN literal, deliberately, and not `OPERATIONS_API` from
 * `./utils` (which prefixes `ApiConfig.API_BASE_URL`). This is the exact
 * string the pipeline page has been polling; the lift is a move, not a
 * behaviour change, and the console has both conventions in it today
 * (`CoordNav`'s alerts and notifications badges are literals too). Reconcile
 * them deliberately, in a change that is about that — not as a side effect of
 * moving a hook between files.
 */
export const FLEET_HEALTH_API = "/api/v1/operations/fleet/health";

/**
 * Poll cadence. Coord's device prober runs far slower than this; 10 s is the
 * foreground cadence for a page whose whole job is machine liveness.
 */
export const FLEET_HEALTH_POLL_MS = 10_000;

export interface FleetHealthDevice {
  device_id: string;
  hostname?: string;
  /**
   * Coord liveness state — `DeviceHealthSnapshot.state` (Rust
   * `DeviceState`, serde-lowercase): healthy | degraded | partitioned |
   * abandoned. Absent on a device coord has no verdict for, which renders as
   * `unknown` — never as healthy.
   */
  state?: string;
}

export interface FleetHealthPayload {
  devices?: FleetHealthDevice[];
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

  const refresh = useCallback(async () => {
    try {
      const body = await httpClient.get<FleetHealthPayload>(FLEET_HEALTH_API);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, FLEET_HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading, error, refresh };
}
