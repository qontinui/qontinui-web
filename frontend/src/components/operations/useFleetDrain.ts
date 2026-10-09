"use client";

/**
 * `GET /api/v1/operations/fleet/drain` — which machines coord is currently
 * holding out of the fleet, and the two writes that change that.
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
 * a drain lasts hours, and the page's own writes force an immediate refresh
 * (`refresh()` is handed to the control), so the poll only has to catch
 * another operator's action and the expiry itself.
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
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  fetchFleetDrain,
  postFleetDrain,
  postFleetUndrain,
} from "@/lib/api/operations/coordFleet";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import { parseFleetDrain, type FleetDrainRead } from "./fleetDrain";

/**
 * Poll cadence. Slow on purpose — see the module doc. A drain is measured in
 * hours; this only has to notice somebody else's action and the expiry.
 */
export const FLEET_DRAIN_POLL_MS = 30_000;

const LOADING: FleetDrainRead = { state: "loading" };

export interface UseFleetDrainResult {
  read: FleetDrainRead;
  /** Force a re-read. Wired to the control so a write is visible at once. */
  refresh: () => Promise<void>;
}

export function useFleetDrain(): UseFleetDrainResult {
  const [read, setRead] = useState<FleetDrainRead>(LOADING);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5). The
  // control's post-write `refresh()` is never dropped: one issued while a
  // poll is in flight runs once, right after it, so the write is visible.
  const poll = useCallback(async (isCurrent: () => boolean) => {
    let next: FleetDrainRead;
    try {
      next = parseFleetDrain(
        await fetchFleetDrain(COORD_DASHBOARD_POLL_OPTIONS)
      );
    } catch (err) {
      // The client rejects a non-2xx as `<METHOD> <url> failed: <status> - …`,
      // so the status is read back with the console's one anchored parser.
      const status = httpStatusOf(err);
      if (status === 404) {
        next = {
          state: "unknown",
          reason:
            "Coord serves no drain read on this deployment " +
            "(GET /coord/fleet/drain answered 404). Machines may still be " +
            "drained — this build simply cannot ask. Expected while coord " +
            "is a deploy behind this console.",
        };
      } else if (status !== null) {
        next = {
          state: "unknown",
          reason:
            `The drain read returned HTTP ${status}, so no machine's ` +
            "drain state could be determined from it.",
        };
      } else {
        // An unreadable body (the client's `res.json()` throws a SyntaxError)
        // and a transport failure are the same UNKNOWN to the operator, but
        // only the first has a message worth naming.
        const detail =
          err instanceof SyntaxError
            ? `the drain read did not return valid JSON: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        next = {
          state: "unknown",
          reason: `Coord's drain state could not be read — ${detail}`,
        };
      }
    }
    if (isCurrent()) setRead(next);
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_DRAIN_POLL_MS);

  return { read, refresh };
}

/** The outcome of a drain/undrain write, as the control renders it. */
export type DrainWriteResult =
  | { ok: true; changed: boolean }
  | { ok: false; status: number | null; body: string };

/**
 * `POST /api/v1/operations/fleet/drain`.
 *
 * The body is assembled here from the three fields coord's `DrainRequest`
 * declares and nothing else: that struct is `#[serde(deny_unknown_fields)]`,
 * so one hopeful extra key is a 422 for the whole write. `drained_by` is
 * deliberately absent — coord stamps the author from the authenticated
 * operator context, and an audit trail with a client-asserted author is not an
 * audit trail.
 */
export async function postDrain(input: {
  deviceId: string;
  untilIso: string;
  reason: string;
}): Promise<DrainWriteResult> {
  return settleDrainChange(
    postFleetDrain({
      device_id: input.deviceId,
      until: input.untilIso,
      reason: input.reason,
    })
  );
}

/** `POST /api/v1/operations/fleet/undrain`. Coord requires a reason here too. */
export async function postUndrain(input: {
  deviceId: string;
  reason: string;
}): Promise<DrainWriteResult> {
  return settleDrainChange(
    postFleetUndrain({ device_id: input.deviceId, reason: input.reason })
  );
}

async function settleDrainChange(
  write: Promise<unknown>
): Promise<DrainWriteResult> {
  try {
    const payload = await write;
    // Coord reports `changed: false` for a request that altered nothing — an
    // undrain of a machine that was not held. Passed through rather than
    // dressed up as a successful release, so the operator can tell "I released
    // it" from "it was not held". A success with an unreadable body (the
    // client resolves `null`) still succeeded; `changed` stays true, which is
    // the reading that does not claim a no-op happened.
    let changed = true;
    if (
      typeof payload === "object" &&
      payload !== null &&
      "changed" in payload &&
      typeof (payload as { changed: unknown }).changed === "boolean"
    ) {
      changed = (payload as { changed: boolean }).changed;
    }
    return { ok: true, changed };
  } catch (err) {
    return {
      ok: false,
      status: httpStatusOf(err),
      body:
        httpBodyOf(err) ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}
