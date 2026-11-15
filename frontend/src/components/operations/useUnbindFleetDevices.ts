"use client";

/**
 * Transport for "Remove from this tenant…": one call to
 * `POST /api/v1/operations/fleet/devices/unbind`, then a roster re-read.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3. What an answer means lives in `./removeMachineFromTenant.ts`.
 *
 * On settle — success, partial, refusal or a lost answer — it calls the
 * roster's own `refresh()` (`useFleetDispatchRoles` is `useState` +
 * `useSingleFlightPoll`; there is no query cache to invalidate), so the list
 * shows what coord now holds rather than what this call claimed.
 */

import { useCallback, useRef, useState } from "react";
import {
  UNBIND_BATCH_LIMIT,
  unbindFleetDevices,
  type DeviceUnbindResultWire,
} from "@/lib/api/operations/coordDeviceBindings";
import {
  describeUnbindRejection,
  summarizeUnbind,
  type UnbindRefusal,
  type UnbindSummary,
} from "./removeMachineFromTenant";

export type UnbindState =
  | { state: "idle" }
  | { state: "busy" }
  /** The route answered per id (which may still include failures). */
  | { state: "answered"; summary: UnbindSummary }
  /** The route refused the request as a whole. */
  | { state: "refused"; refusal: UnbindRefusal };

export type UnbindOutcome =
  | { state: "answered"; summary: UnbindSummary }
  | { state: "refused"; refusal: UnbindRefusal }
  /** A removal was already in flight; this one was not sent. */
  | { state: "in_flight" };

export interface UseUnbindFleetDevicesResult {
  status: UnbindState;
  /**
   * A removal is in flight OR its roster re-read has not settled yet. The
   * answer is shown as soon as it arrives, but a second removal is refused
   * until the re-read lands, so it is never built from the list as it was.
   */
  busy: boolean;
  /** Unbind `deviceIds` from the active tenant. Never runs two at once. */
  unbind: (deviceIds: readonly string[]) => Promise<UnbindOutcome>;
  /** Forget the last answer (the dialog was reopened). */
  reset: () => void;
}

export function useUnbindFleetDevices(
  /** The roster's re-read, called once each removal settles. */
  refresh: () => Promise<void> | void
): UseUnbindFleetDevicesResult {
  const [status, setStatus] = useState<UnbindState>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const unbind = useCallback(
    async (deviceIds: readonly string[]): Promise<UnbindOutcome> => {
      if (inFlight.current) return { state: "in_flight" };
      inFlight.current = true;
      setBusy(true);
      setStatus({ state: "busy" });
      // The route takes at most UNBIND_BATCH_LIMIT ids: send sequential
      // batches and merge their rows. Any rejection stops the run (an auth
      // abort above all); later batches are reported as never sent.
      const batches: string[][] = [];
      for (let i = 0; i < deviceIds.length; i += UNBIND_BATCH_LIMIT) {
        batches.push(deviceIds.slice(i, i + UNBIND_BATCH_LIMIT));
      }
      const prior: DeviceUnbindResultWire[] = [];
      let outcome: UnbindOutcome | null = null;
      for (let b = 0; b < batches.length; b += 1) {
        try {
          const body = await unbindFleetDevices(batches[b]!);
          // An unreadable 2xx body leaves this batch's ids unreported.
          if (body !== null && Array.isArray(body.results))
            prior.push(...body.results);
        } catch (err) {
          outcome = {
            state: "refused",
            refusal: describeUnbindRejection(deviceIds, err, {
              prior,
              neverSent: batches.slice(b + 1).flat(),
            }),
          };
          break;
        }
      }
      if (outcome === null) {
        outcome = {
          state: "answered",
          summary: summarizeUnbind(deviceIds, {
            results: prior,
          }),
        };
      }
      setStatus(outcome);
      try {
        await refresh();
      } catch {
        // The roster's own read reports its failure as UNKNOWN; the removal's
        // answer above stands either way.
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
      return outcome;
    },
    [refresh]
  );

  const reset = useCallback(() => {
    if (!inFlight.current) setStatus({ state: "idle" });
  }, []);

  return { status, busy, unbind, reset };
}
