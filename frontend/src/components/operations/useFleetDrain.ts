"use client";

/**
 * `GET /api/v1/operations/fleet/drain` — which machines coord is currently
 * holding out of the fleet. Read-only: the console pauses a machine through a
 * maintenance window (`useMaintenanceWindow.ts`), which coord composes from a
 * drain, so the direct drain/undrain writes were deleted with the Runner
 * Drain page.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b. The parse and every rule about what a body means live in
 * `./fleetDrain.ts`; this file is the transport and the polling cadence, and
 * nothing else.
 *
 * ## Why this read polls, when the sibling roster deliberately does not
 *
 * `useDevenvMachines` reads once and argues, correctly, that a roster changes
 * on an operator's enrolment rather than on a telemetry cadence. A drain looks
 * like that — it too changes by an operator action — but it has a property the
 * roster does not: **it expires by itself.** Coord evaluates `until` on READ
 * and runs no sweeper, so a machine re-enters the fleet with nothing writing
 * anything anywhere. A once-only read would leave "Drained until 14:03"
 * on screen at 15:00, which is a false claim about the fleet rather than a
 * stale one about a list.
 *
 * The cadence is slower than fleet health's 10 s because the fact is coarser:
 * a drain lasts hours, and a maintenance-window write forces an immediate
 * refresh, so the poll only has to catch another operator's action and the
 * expiry itself.
 *
 * ## Every failure lands on UNKNOWN, and the 404 is the interesting one
 *
 * `GET /coord/fleet/drain` is being added by this plan's Phase 4a, and coord
 * and qontinui-web deploy independently. So there is a real window in which
 * this route answers 404 — and the honest reading of that is exactly the same
 * as the reading of a timeout: **the drain state is unknown**. It is not "no
 * machine is drained", which is what a `?? []` would have said, and it is not
 * an error banner either, because a console that shouts during every deploy
 * window teaches the operator to stop reading it. The reason string names the
 * deploy window so a reader is not left hunting a fault that is not there.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import { OPERATIONS_API } from "./utils";
import { parseFleetDrain, type FleetDrainRead } from "./fleetDrain";

export const FLEET_DRAIN_API = `${OPERATIONS_API}/fleet/drain`;

/**
 * Poll cadence. Slow on purpose — see the module doc. A drain is measured in
 * hours; this only has to notice somebody else's action and the expiry.
 */
export const FLEET_DRAIN_POLL_MS = 30_000;

const LOADING: FleetDrainRead = { state: "loading" };

export interface UseFleetDrainResult {
  read: FleetDrainRead;
  /** Force a re-read, so a maintenance-window write is visible at once. */
  refresh: () => Promise<void>;
}

export function useFleetDrain(): UseFleetDrainResult {
  const [read, setRead] = useState<FleetDrainRead>(LOADING);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5). The
  // page's post-write `refresh()` is never dropped: one issued while a
  // poll is in flight runs once, right after it, so the write is visible.
  const poll = useCallback(async (isCurrent: () => boolean) => {
    let next: FleetDrainRead;
    try {
      const res = await httpClient.fetch(
        FLEET_DRAIN_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (res.status === 404) {
        next = {
          state: "unknown",
          reason:
            "Coord serves no drain read on this deployment " +
            "(GET /coord/fleet/drain answered 404). Machines may still be " +
            "drained — this build simply cannot ask. Expected while coord " +
            "is a deploy behind this console.",
        };
      } else if (!res.ok) {
        next = {
          state: "unknown",
          reason:
            `The drain read returned HTTP ${res.status}, so no machine's ` +
            "drain state could be determined from it.",
        };
      } else {
        // Two arms rather than a nullable `payload`: an unreadable body and a
        // body that reads as `undefined` are the same UNKNOWN to the operator,
        // but only one of them has a message worth showing.
        let parsed: unknown;
        try {
          parsed = await res.json();
        } catch (err) {
          throw new Error(
            `the drain read did not return valid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`
          );
        }
        next = parseFleetDrain(parsed);
      }
    } catch (err) {
      next = {
        state: "unknown",
        reason: `Coord's drain state could not be read — ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    if (isCurrent()) setRead(next);
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_DRAIN_POLL_MS);

  return { read, refresh };
}
