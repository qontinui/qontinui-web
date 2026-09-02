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

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import { parseFleetDrain, type FleetDrainRead } from "./fleetDrain";

export const FLEET_DRAIN_API = `${OPERATIONS_API}/fleet/drain`;
export const FLEET_UNDRAIN_API = `${OPERATIONS_API}/fleet/undrain`;

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
  // Guards a `setState` after unmount without making `refresh` unstable.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    let next: FleetDrainRead;
    try {
      const res = await httpClient.fetch(FLEET_DRAIN_API);
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
    if (live.current) setRead(next);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), FLEET_DRAIN_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

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
  return postDrainChange(FLEET_DRAIN_API, {
    device_id: input.deviceId,
    until: input.untilIso,
    reason: input.reason,
  });
}

/** `POST /api/v1/operations/fleet/undrain`. Coord requires a reason here too. */
export async function postUndrain(input: {
  deviceId: string;
  reason: string;
}): Promise<DrainWriteResult> {
  return postDrainChange(FLEET_UNDRAIN_API, {
    device_id: input.deviceId,
    reason: input.reason,
  });
}

async function postDrainChange(
  url: string,
  body: Record<string, string>
): Promise<DrainWriteResult> {
  try {
    const res = await httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text() };
    }
    // Coord reports `changed: false` for a request that altered nothing — an
    // undrain of a machine that was not held. Passed through rather than
    // dressed up as a successful release, so the operator can tell "I released
    // it" from "it was not held".
    let changed = true;
    try {
      const payload: unknown = await res.json();
      if (
        typeof payload === "object" &&
        payload !== null &&
        "changed" in payload &&
        typeof (payload as { changed: unknown }).changed === "boolean"
      ) {
        changed = (payload as { changed: boolean }).changed;
      }
    } catch {
      // A success with an unreadable body still succeeded; `changed` stays
      // true, which is the reading that does not claim a no-op happened.
    }
    return { ok: true, changed };
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}
