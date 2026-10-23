"use client";

/**
 * `GET /api/v1/operations/fleet/dispatch-roles` and the one write that changes
 * a machine's role, `PUT /api/v1/operations/fleet/dispatch-role`.
 *
 * Plan `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6
 * (minimal). Transport and polling only; every rule about what a body means
 * is in `./fleetDispatchRoles.ts`. Same shape as `useFleetDrain.ts`, and for
 * the same reason every failure — including the 404 of a coord a deploy
 * behind this console — is UNKNOWN, never "every machine unassigned".
 *
 * Polls slowly: a role changes only by an operator's action (it never expires,
 * unlike a drain), so the poll exists to catch another operator's write and
 * the drain half of each lane's state. The panel's own write forces a re-read.
 */

import { useCallback, useState } from "react";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  fetchFleetDispatchRoles,
  putFleetDispatchRole,
  type DispatchRoleRequest,
  type FleetWriteAck,
} from "@/lib/api/operations/coordFleet";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import {
  parseDispatchRoles,
  parseEffectsNotApplied,
  type DispatchRole,
  type DispatchRolesRead,
  type EffectNotApplied,
} from "./fleetDispatchRoles";

export const FLEET_DISPATCH_ROLES_POLL_MS = 30_000;

const LOADING: DispatchRolesRead = { state: "loading" };

export interface UseFleetDispatchRolesResult {
  read: DispatchRolesRead;
  /**
   * `Date.now()` when the read last came back `known`, or `null` before it
   * ever has. The route serves no timestamp, so this is what the presentation
   * lens's provenance chip dates the roles by (plan
   * `2026-10-23-console-presentation-spaces` Phase 7). An `unknown` read
   * never moves it.
   */
  fetchedAtMs: number | null;
  refresh: () => Promise<void>;
}

export function useFleetDispatchRoles(): UseFleetDispatchRolesResult {
  const [read, setRead] = useState<DispatchRolesRead>(LOADING);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    let next: DispatchRolesRead;
    try {
      next = parseDispatchRoles(
        await fetchFleetDispatchRoles(COORD_DASHBOARD_POLL_OPTIONS)
      );
    } catch (err) {
      const status = httpStatusOf(err);
      if (status === 404) {
        next = {
          state: "unknown",
          reason:
            "Coord serves no dispatch-role read on this deployment " +
            "(GET /coord/fleet/dispatch-roles answered 404). Roles may still " +
            "be set — this build cannot ask. Expected while coord is a deploy " +
            "behind this console.",
        };
      } else if (status !== null) {
        next = {
          state: "unknown",
          reason:
            `The dispatch-role read returned HTTP ${status}, so no ` +
            "machine's role could be determined from it.",
        };
      } else {
        const message =
          err instanceof SyntaxError
            ? `the dispatch-role read did not return valid JSON: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        next = {
          state: "unknown",
          reason: `Coord's dispatch roles could not be read — ${message}`,
        };
      }
    }
    if (!isCurrent()) return;
    setRead(next);
    if (next.state === "known") setFetchedAtMs(Date.now());
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_DISPATCH_ROLES_POLL_MS);
  return { read, fetchedAtMs, refresh };
}

export type RoleWriteResult =
  | {
      ok: true;
      /** Coord's `changed`: `false` when the machine already had this role. */
      changed: boolean;
      /**
       * Coord's `live_sessions_on_machine`: a count, `"unknown"` when coord
       * served `null` (not measured — a CI-host write, or an unreadable count;
       * never 0), or `undefined` when the field was not served.
       */
      liveSessions: number | "unknown" | undefined;
      /**
       * Coord's `effects_not_applied` — what this build of coord did NOT do
       * for the change. `null` when not served (never read as "none").
       */
      notApplied: EffectNotApplied[] | null;
    }
  | { ok: false; status: number | null; body: string };

/**
 * `PUT /api/v1/operations/fleet/dispatch-role`. Exactly one of `deviceId` /
 * `ciHostName` names the machine; no author field — coord stamps it.
 */
export async function putDispatchRole(input: {
  deviceId?: string | null;
  ciHostName?: string | null;
  role: DispatchRole;
  reason: string;
  force: boolean;
}): Promise<RoleWriteResult> {
  const body: DispatchRoleRequest = {
    dispatch_role: input.role,
    reason: input.reason,
    force: input.force,
  };
  if (input.deviceId) body.device_id = input.deviceId;
  else body.ci_host_name = input.ciHostName;
  // Never auto-retried (`putFleetDispatchRole`: `maxRetries: 0`) — a retry
  // after a lost-but-committed first attempt would report "nothing changed"
  // for a change this operator just made. A 5xx reaches here, and the caller
  // re-reads instead.
  let payload: FleetWriteAck | null;
  try {
    payload = await putFleetDispatchRole(body);
  } catch (err) {
    const status = httpStatusOf(err);
    if (status !== null) {
      return { ok: false, status, body: httpBodyOf(err) ?? "" };
    }
    return {
      ok: false,
      status: null,
      body: err instanceof Error ? err.message : String(err),
    };
  }
  // A success with an unreadable body (`null`) still succeeded; `changed`
  // stays true, the reading that does not claim a no-op happened.
  let changed = true;
  let liveSessions: number | "unknown" | undefined = undefined;
  let notApplied: EffectNotApplied[] | null = null;
  if (payload !== null && typeof payload === "object") {
    if (typeof payload.changed === "boolean") changed = payload.changed;
    if (typeof payload.live_sessions_on_machine === "number")
      liveSessions = payload.live_sessions_on_machine;
    else if ("live_sessions_on_machine" in payload)
      // `null` (or a shape we do not know) is NOT MEASURED — never 0.
      liveSessions = "unknown";
    notApplied = parseEffectsNotApplied(payload.effects_not_applied);
  }
  return { ok: true, changed, liveSessions, notApplied };
}
