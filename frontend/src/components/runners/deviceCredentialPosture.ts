/**
 * Pure joins for the `/runners` Devices tab's credential panel.
 *
 * Plan `2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web`
 * Phase 1. The posture VOCABULARY and its one rule — a missing, stale or
 * pruned report is UNKNOWN, never "authenticated" — live in
 * `components/operations/coordCredentialStatus.ts`; this module only finds the
 * right coord `device_status` row for a device and hands it to that resolver.
 * It never renders or decides a posture itself, so there is one posture
 * renderer, not two.
 */

import {
  coordDeviceHostKey,
  reportedCoordCredential,
  resolveCoordCredential,
  type CoordCredentialStatus,
} from "@/components/operations/coordCredentialStatus";
import type { DeviceStatus } from "@/components/operations/types";
import type { DeviceCredentialOverviewRow } from "@/lib/api/device_credentials";

/** Compare device ids the way both services print a UUID. */
export function normalizeDeviceId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * The coord `device_status` row that belongs to THIS device, or undefined.
 *
 * The stream is keyed `hostname ?? device_id` (`coordDeviceHostKey`), so the
 * row is looked up under the device's hostname first and its id second — and
 * accepted only when the row's own `device_id` matches. A re-paired box that
 * shares a hostname with a retired device must not lend it a report.
 */
export function findDeviceStatusRow(
  byHostname: ReadonlyMap<string, DeviceStatus>,
  deviceId: string,
  hostname: string | null | undefined
): DeviceStatus | undefined {
  const want = normalizeDeviceId(deviceId);
  const keys = [
    coordDeviceHostKey({ device_id: deviceId, hostname: hostname ?? null }),
    deviceId,
    want,
  ];
  for (const key of keys) {
    const row = byHostname.get(key);
    if (row && normalizeDeviceId(row.device_id) === want) return row;
  }
  return undefined;
}

/** A device's posture plus when coord last heard its report. */
export interface DevicePosture {
  credential: CoordCredentialStatus;
  /** The matched status row's `updated_at`, or null when there is no row. */
  lastObserved: string | null;
}

/**
 * Resolve a device's credential posture through the shared resolver.
 *
 * No row (never reported, pruned by coord after an hour, or the stream has not
 * loaded or failed) ⇒ the resolver's `unknown`. A row past its staleness bound
 * ⇒ `unknown` too. Only a fresh runner-published bag can say `live`.
 */
export function resolveDevicePosture(
  byHostname: ReadonlyMap<string, DeviceStatus>,
  deviceId: string,
  hostname: string | null | undefined,
  now: number
): DevicePosture {
  const row = findDeviceStatusRow(byHostname, deviceId, hostname);
  const credential = resolveCoordCredential({
    // `row` already passed the device-id guard in `findDeviceStatusRow`.
    ...reportedCoordCredential(row),
    now,
  });
  return { credential, lastObserved: row?.updated_at ?? null };
}

/** Index the overview by normalized device id. */
export function indexCredentialOverview(
  rows: readonly DeviceCredentialOverviewRow[]
): Map<string, DeviceCredentialOverviewRow> {
  const map = new Map<string, DeviceCredentialOverviewRow>();
  for (const row of rows) map.set(normalizeDeviceId(row.device_id), row);
  return map;
}

/**
 * The Authenticate button is offered for every runner that is not `live`, and
 * for every device carrying the device-scoped deny: a revoked runner can still
 * read `live` for the rest of its current token's life (up to ~4h), and
 * Authenticate is the only thing that lifts the deny.
 */
export function canAuthenticate(
  posture: CoordCredentialStatus,
  overview?: DeviceCredentialOverviewRow
): boolean {
  return posture.kind !== "live" || isCredentialRevoked(overview);
}

/** The device-scoped deny (`credential_revoked_at`) is set. */
export function isCredentialRevoked(
  overview: DeviceCredentialOverviewRow | undefined
): boolean {
  return (
    overview?.credential_revoked_at !== null &&
    overview?.credential_revoked_at !== undefined
  );
}

/**
 * Revoke is offered whenever the device-scoped deny is NOT set, whether or
 * not a machine key is held: the deny is what stops the refresh chain, so a
 * device with no key still has something to revoke. With no overview row the
 * deny's state is unknown, so nothing is offered.
 */
export function canRevoke(
  overview: DeviceCredentialOverviewRow | undefined
): boolean {
  return overview !== undefined && !isCredentialRevoked(overview);
}

/** A machine key is held and not revoked — the only case Revoke withdraws one. */
export function holdsActiveMachineKey(
  overview: DeviceCredentialOverviewRow | undefined
): boolean {
  return (
    overview !== undefined &&
    overview.machine_key.present &&
    overview.machine_key.revoked_at === null
  );
}

/**
 * A pending authorization is shown only while it has not lapsed. An
 * unparseable timestamp is treated as still pending — the server said one
 * exists, and hiding it would hide the only record of the click.
 */
export function isPendingLive(
  pending: { expires_at: string } | null | undefined,
  now: number
): boolean {
  if (!pending) return false;
  const ms = Date.parse(pending.expires_at);
  return !Number.isFinite(ms) || ms > now;
}
