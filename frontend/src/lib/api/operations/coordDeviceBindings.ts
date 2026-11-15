/**
 * `/operations/fleet/devices/unbind` — remove THIS tenant's binding of one or
 * more coord devices.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3 (D1, D3). The web route (`endpoints/fleet_device_bindings.py`) calls
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
  /** `already_absent` = coord's 404 `binding_not_found`. */
  outcome: "unbound" | "already_absent" | "failed" | (string & {});
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

export interface DeviceUnbindResponseWire {
  results: DeviceUnbindResultWire[];
  unbound: number;
  already_absent: number;
  failed: number;
}

/**
 * `POST /fleet/devices/unbind` with `{device_ids}` (1–64 unique ids). Never
 * re-issued on a 5xx (`idempotent: false`), the same policy as
 * `postFleetDrain`: a repeat is harmless here (it reads `already_absent`), but
 * it would misreport the first attempt's `unbound` as `already_absent`.
 *
 * A 401/403 aborts the batch and rejects with that status (an auth failure is
 * a property of the caller, not of any row); every other per-id failure comes
 * back inside `results`. `null` when a 2xx body could not be parsed.
 */
export async function unbindFleetDevices(
  deviceIds: readonly string[]
): Promise<DeviceUnbindResponseWire | null> {
  const url = `${OPERATIONS_BASE}/fleet/devices/unbind`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ device_ids: deviceIds }),
    idempotent: false,
  });
  return readJson<DeviceUnbindResponseWire>(res, `POST ${url}`, {
    unparseable: "null",
  });
}
