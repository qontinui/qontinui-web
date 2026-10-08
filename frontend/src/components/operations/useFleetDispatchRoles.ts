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
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import { OPERATIONS_API } from "./utils";
import {
  parseDispatchRoles,
  type DispatchRole,
  type DispatchRolesRead,
} from "./fleetDispatchRoles";

export const FLEET_DISPATCH_ROLES_API = `${OPERATIONS_API}/fleet/dispatch-roles`;
export const FLEET_DISPATCH_ROLE_API = `${OPERATIONS_API}/fleet/dispatch-role`;

export const FLEET_DISPATCH_ROLES_POLL_MS = 30_000;

const LOADING: DispatchRolesRead = { state: "loading" };

export interface UseFleetDispatchRolesResult {
  read: DispatchRolesRead;
  refresh: () => Promise<void>;
}

export function useFleetDispatchRoles(): UseFleetDispatchRolesResult {
  const [read, setRead] = useState<DispatchRolesRead>(LOADING);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    let next: DispatchRolesRead;
    try {
      const res = await httpClient.fetch(
        FLEET_DISPATCH_ROLES_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (res.status === 404) {
        next = {
          state: "unknown",
          reason:
            "Coord serves no dispatch-role read on this deployment " +
            "(GET /coord/fleet/dispatch-roles answered 404). Roles may still " +
            "be set — this build cannot ask. Expected while coord is a deploy " +
            "behind this console.",
        };
      } else if (!res.ok) {
        next = {
          state: "unknown",
          reason:
            `The dispatch-role read returned HTTP ${res.status}, so no ` +
            "machine's role could be determined from it.",
        };
      } else {
        let parsed: unknown;
        try {
          parsed = await res.json();
        } catch (err) {
          throw new Error(
            `the dispatch-role read did not return valid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`
          );
        }
        next = parseDispatchRoles(parsed);
      }
    } catch (err) {
      next = {
        state: "unknown",
        reason: `Coord's dispatch roles could not be read — ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    if (isCurrent()) setRead(next);
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_DISPATCH_ROLES_POLL_MS);
  return { read, refresh };
}

export type RoleWriteResult =
  | {
      ok: true;
      /** Coord's `changed`: `false` when the machine already had this role. */
      changed: boolean;
      /** Coord's `live_sessions_on_machine`, when served. */
      liveSessions: number | null;
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
  const body: Record<string, unknown> = {
    dispatch_role: input.role,
    reason: input.reason,
    force: input.force,
  };
  if (input.deviceId) body.device_id = input.deviceId;
  else body.ci_host_name = input.ciHostName;
  try {
    const res = await httpClient.fetch(FLEET_DISPATCH_ROLE_API, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text() };
    }
    // A success with an unreadable body still succeeded; `changed` stays
    // true, the reading that does not claim a no-op happened.
    let changed = true;
    let liveSessions: number | null = null;
    try {
      const payload: unknown = await res.json();
      if (typeof payload === "object" && payload !== null) {
        const p = payload as Record<string, unknown>;
        if (typeof p.changed === "boolean") changed = p.changed;
        if (typeof p.live_sessions_on_machine === "number")
          liveSessions = p.live_sessions_on_machine;
      }
    } catch {
      // see above
    }
    return { ok: true, changed, liveSessions };
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}
