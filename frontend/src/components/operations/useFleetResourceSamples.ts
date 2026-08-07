"use client";

/**
 * Polling hook for the fleet resource-sample surface (plan
 * `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C2).
 *
 * Transport: the authenticated REST proxy
 * `GET /api/v1/operations/fleet/resource-samples`, which forwards the
 * operator bearer to coord's `GET /coord/devices/resource-samples` and keeps
 * tenant scoping server-side.
 *
 * **Never call coord from the browser.** `DeviceStatusTile` records what
 * happened the last time: the tile fetched coord through the `/coord-api/*`
 * rewrite with `credentials: "omit"`, coord went operator-auth fail-closed,
 * and the tile SILENTLY EMPTIED — a blank panel that read as "nothing is
 * wrong". Routing through the web backend is what stops that recurring.
 *
 * REST-only, no WS: unlike `device-status`, there is no coord push channel
 * for resource samples, and the publishers run on a 30 s cadence — a poll
 * slower than the publisher is all the freshness there is to have. This adds
 * no `/coord/status` poll to `MachineCard`; that shipped as Phase 1.3 and was
 * deliberately deleted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import type { ResourceSamplesResponse } from "./fleetResources";

export const FLEET_RESOURCE_SAMPLES_API = `${OPERATIONS_API}/fleet/resource-samples`;

/** Poll cadence. Matches the runner's 30 s publish cadence. */
export const RESOURCE_POLL_INTERVAL_MS = 30_000;

/** Sparkline window requested by default: 1 h (coord's own default). */
export const DEFAULT_WINDOW_SECS = 3_600;

export interface UseFleetResourceSamplesResult {
  data: ResourceSamplesResponse | null;
  loading: boolean;
  /**
   * Transport/proxy failure. `data` is deliberately NOT cleared — dropping the
   * last payload would render the fleet as *absent*, and absent is a different
   * (and equally wrong) claim from *stale*.
   *
   * What keeps the surface honest during an outage is `fetchedAtMs`, not this
   * flag: `age_secs` is frozen inside the payload, so on its own it would say
   * "15 seconds old" forever.
   */
  error: string | null;
  /**
   * `Date.now()` when `data` arrived, or `null` before the first success.
   *
   * Callers add `(now - fetchedAtMs)/1000` to each row's server-computed
   * `age_secs` (`effectiveAgeSecs`), so rows cross the stale threshold on
   * their own whether the silence is the publisher's, coord's, or this
   * proxy's. Only an INTERVAL is measured client-side — never an absolute
   * time — so no clock skew is reintroduced.
   */
  fetchedAtMs: number | null;
  refresh: () => void;
}

export function useFleetResourceSamples(options?: {
  windowSecs?: number;
  enabled?: boolean;
}): UseFleetResourceSamplesResult {
  const windowSecs = options?.windowSecs ?? DEFAULT_WINDOW_SECS;
  const enabled = options?.enabled ?? true;

  const [data, setData] = useState<ResourceSamplesResponse | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const body = await httpClient.get<ResourceSamplesResponse>(
        `${FLEET_RESOURCE_SAMPLES_API}?window_secs=${encodeURIComponent(
          String(windowSecs)
        )}`
      );
      if (cancelledRef.current) return;
      setData(body);
      // Stamped ONLY on success. A failed poll must not refresh the clock the
      // staleness rule reads, or an outage would keep resetting every row to
      // "fresh" — the frozen-`age_secs` bug in a new costume.
      setFetchedAtMs(Date.now());
      setError(null);
    } catch (e) {
      if (cancelledRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [windowSecs]);

  useEffect(() => {
    // Reset on EVERY run, including the disabled one: leaving the ref `true`
    // from a prior cleanup would make a later manual refresh() silently
    // discard its own response.
    cancelledRef.current = false;
    if (!enabled) {
      setLoading(false);
      return;
    }
    refresh();
    const id = setInterval(refresh, RESOURCE_POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [refresh, enabled]);

  return { data, loading, error, fetchedAtMs, refresh };
}
