/**
 * `/operations/fleet/devices/unbind` — remove THIS tenant's binding of one or
 * more coord devices.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3 (D1, D3). The web route (`POST /api/v1/operations/fleet/devices/unbind`) calls
 * coord's per-tenant unbind (`DELETE /coord/devices/:id/tenant-binding`) once
 * per id and answers a per-id outcome; it never deletes a device row, and it
 * never touches another tenant's binding. Full deregistration stays with the
 * device's owner on `/runners`.
 *
 * Its own module rather than a section of `coordFleet.ts`, which is a read
 * catalogue and already near 900 lines.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One id's outcome, as the web route serves it. */
export interface DeviceUnbindResultWire {
  device_id: string;
  /**
   * `already_absent` = coord's 404 `binding_not_found`; `unknown` = coord's
   * answer was lost (the binding MAY have been removed); `not_attempted` = the
   * batch hit its deadline before this id.
   */
  outcome:
    | "unbound"
    | "already_absent"
    | "failed"
    | "unknown"
    | "not_attempted"
    | (string & {});
  /** Coord's HTTP status for this id. */
  status: number | null;
  /** Coord's structured refusal (or its text) for a `failed` id. */
  error: unknown;
  /**
   * D4: after the edge delete, the device's legacy home-tenant pointer still
   * names this tenant, so the roster keeps listing it. `null` = coord did not
   * report it (a build predating the field) — never read as `false`.
   */
  still_member_via_pointer: boolean | null;
}

/**
 * One row per requested id, in order. The tallies are ints, but the console
 * never relies on them: the per-id rows decide, so a tally that is absent or
 * of another type changes nothing.
 */
export interface DeviceUnbindResponseWire {
  results: DeviceUnbindResultWire[];
  unbound?: number;
  already_absent?: number;
  unknown?: number;
  failed?: number;
  not_attempted?: number;
}

/** The route's per-request limit on `device_ids`. */
export const UNBIND_BATCH_LIMIT = 64;

/**
 * `POST /fleet/devices/unbind` with `{device_ids}` (1–64 unique ids; a caller
 * with more sends batches — `useUnbindFleetDevices` does).
 *
 * Never re-sent by the retry chain: `maxRetries: 0` suppresses both the 429
 * arm and any 5xx re-issue (`idempotent: false` alone would still retry a
 * 429). A repeat would misreport the first attempt's `unbound` rows as
 * `already_absent`.
 *
 * The one replay left is `httpClient`'s after a stale-token 401 refresh
 * (`replayAfterRefresh`, which only a 401 enters). The route answers 401 only
 * from its own auth gate, BEFORE any id reaches coord — coord's 401 or 403
 * comes back as HTTP 403 with coord's status in `coord_status` — so that
 * replay re-sends a request nothing acted on, and is harmless.
 *
 * A 403 abort (`coord_refused_caller`) rejects with that status (an auth
 * failure is a property of the caller, not of any row); every other per-id
 * failure comes back inside `results`. `null` when a 2xx body could not be
 * parsed.
 */
export async function unbindFleetDevices(
  deviceIds: readonly string[]
): Promise<DeviceUnbindResponseWire | null> {
  const url = `${OPERATIONS_BASE}/fleet/devices/unbind`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ device_ids: deviceIds }),
    idempotent: false,
    // Exactly one request: no 429 or 5xx re-issue. (A repeat would read the
    // first attempt's `unbound` rows back as `already_absent`.)
    maxRetries: 0,
  });
  return readJson<DeviceUnbindResponseWire>(res, `POST ${url}`, {
    unparseable: "null",
  });
}
