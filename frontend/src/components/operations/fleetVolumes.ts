/**
 * Volume free-space telemetry — the PURE parse + join helpers behind the
 * per-machine disk section.
 *
 * Plan: `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 1
 * (steps 8-11, web half). Rows originate in coord's `worktree_volume` oplog,
 * which already exists — **this phase ships no alembic migration** — and are
 * read over coord HTTP via `GET /api/v1/operations/fleet/volumes`, because web
 * never reads coord's Postgres schema directly
 * (`backend/tests/test_coord_schema_boundary_guard.py`).
 *
 * ## The one thing this module exists to prevent
 *
 * A device with no telemetry rendering as `0` — or as green. A read that
 * failed and a population that is genuinely empty must never render the same
 * (`verification-and-evidence` `silent-empty-is-unknown`, plan D10). So:
 *
 * - Every failure path produces `{state: "unavailable", reason}` — never an
 *   empty map, which would be indistinguishable from "no device has any disk".
 * - A device absent from a SUCCESSFUL read is `never_reported` — a fact about
 *   the device, which a failed read can never establish.
 * - A byte count that did not arrive as a number becomes `NaN`, not `0`; the
 *   formatters render `NaN` as "unknown". Defaulting it to zero would
 *   manufacture the exact fabricated zero this feature exists to remove.
 */

import type {
  DeviceStatus,
  DeviceVolumes,
  MachineVolumes,
  VolumeReading,
} from "./types";

/**
 * What the last `GET /operations/fleet/volumes` produced.
 *
 * `unavailable` is a first-class state, not a fallback to an empty map: if the
 * read did not answer, every machine's disk section says UNKNOWN with the
 * reason.
 */
export type VolumesFetch =
  | {
      state: "ok";
      byDevice: Map<string, DeviceVolumes>;
      byHostname: Map<string, DeviceVolumes>;
    }
  | { state: "unavailable"; reason: string };

/** The pre-first-read state. Deliberately `unavailable`, not an empty "ok". */
export const VOLUMES_NOT_YET_READ: VolumesFetch = {
  state: "unavailable",
  reason:
    "Disk telemetry has not been read yet in this session -- the first " +
    "fleet-volumes request has not completed.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Coerce one wire row into a {@link VolumeReading}, or `null` when it carries
 * no usable volume identity.
 *
 * Non-numeric byte counts survive as `NaN` on purpose — see the module note.
 */
export function toVolumeReading(raw: unknown): VolumeReading | null {
  if (!isRecord(raw)) return null;
  const volume = raw.volume;
  if (typeof volume !== "string" || volume.length === 0) return null;
  const total = raw.total_bytes;
  const free = raw.free_bytes;
  const observed = raw.observed_at;
  return {
    volume,
    total_bytes: typeof total === "number" ? total : Number.NaN,
    free_bytes: typeof free === "number" ? free : Number.NaN,
    observed_at: typeof observed === "string" ? observed : null,
  };
}

/** Group flat `VolumeRow`s (`{device_id, volume, ...}`) by device. */
export function groupFlatRows(rows: unknown[]): DeviceVolumes[] {
  const byDevice = new Map<string, DeviceVolumes>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const deviceId = row.device_id;
    if (typeof deviceId !== "string") continue;
    const reading = toVolumeReading(row);
    if (!reading) continue;
    let entry = byDevice.get(deviceId);
    if (!entry) {
      entry = {
        device_id: deviceId,
        hostname: typeof row.hostname === "string" ? row.hostname : null,
        volumes: [],
      };
      byDevice.set(deviceId, entry);
    }
    entry.volumes.push(reading);
  }
  return Array.from(byDevice.values());
}

/**
 * Normalize the fleet-volumes payload.
 *
 * Accepts the grouped shape (`{devices: [{device_id, hostname?, volumes[]}]}`)
 * and the flat oplog shape (`{volumes: [{device_id, volume, ...}]}`), plus a
 * bare array of either — coord's `VolumeRow` carries `device_id` on every row,
 * so both are plausible serializations of the same read and the dashboard
 * should not blank out because the envelope differs.
 *
 * Returns `null` when the payload matches none of them, so the caller reports
 * UNKNOWN rather than silently rendering an empty fleet.
 */
export function parseFleetVolumes(payload: unknown): DeviceVolumes[] | null {
  const container = isRecord(payload) ? payload : null;
  const grouped = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.devices)
      ? (container.devices as unknown[])
      : null;

  if (grouped) {
    const out: DeviceVolumes[] = [];
    let sawGrouped = false;
    for (const entry of grouped) {
      if (!isRecord(entry)) continue;
      const deviceId = entry.device_id;
      if (typeof deviceId !== "string") continue;
      if (Array.isArray(entry.volumes)) {
        sawGrouped = true;
        out.push({
          device_id: deviceId,
          hostname: typeof entry.hostname === "string" ? entry.hostname : null,
          volumes: (entry.volumes as unknown[])
            .map(toVolumeReading)
            .filter((v): v is VolumeReading => v !== null),
        });
      }
    }
    if (sawGrouped) return out;
    // A bare array of FLAT rows falls through to the flat grouping.
    if (Array.isArray(payload)) return groupFlatRows(payload);
    return null;
  }

  if (container && Array.isArray(container.volumes)) {
    return groupFlatRows(container.volumes as unknown[]);
  }
  return null;
}

/** Build the lookup maps a {@link VolumesFetch} `ok` state carries. */
export function indexDeviceVolumes(entries: DeviceVolumes[]): VolumesFetch {
  const byDevice = new Map<string, DeviceVolumes>();
  const byHostname = new Map<string, DeviceVolumes>();
  for (const entry of entries) {
    byDevice.set(entry.device_id, entry);
    if (entry.hostname) byHostname.set(entry.hostname, entry);
  }
  return { state: "ok", byDevice, byHostname };
}

/**
 * Resolve ONE machine's disk telemetry state.
 *
 * The join key is `device_id`, which the dashboard learns from the machine's
 * `device_status` row; `hostname` is a fallback for a coord that echoes it. A
 * machine with neither is UNKNOWN **with that reason stated** — it is not
 * "never reported", because we never managed to ask about it.
 */
export function resolveMachineVolumes(
  hostname: string,
  activity: DeviceStatus | undefined,
  fetched: VolumesFetch
): MachineVolumes {
  if (fetched.state !== "ok") {
    return { state: "unknown", reason: fetched.reason };
  }
  const deviceId = activity?.device_id ?? null;
  const entry =
    (deviceId ? fetched.byDevice.get(deviceId) : undefined) ??
    fetched.byHostname.get(hostname);

  if (!entry) {
    if (!deviceId) {
      return {
        state: "unknown",
        reason:
          `This machine has no coord device row in view (no device_status ` +
          `for "${hostname}"), so its disk telemetry could not be looked up. ` +
          `Nothing here says the disk is fine or full -- only that the ` +
          `machine could not be matched to a device.`,
      };
    }
    return { state: "never_reported", deviceId };
  }
  if (entry.volumes.length === 0) {
    return { state: "never_reported", deviceId: entry.device_id };
  }
  return {
    state: "reported",
    deviceId: entry.device_id,
    volumes: entry.volumes,
  };
}

/**
 * The TIGHTEST volume anywhere in the fetched fleet — the number that actually
 * predicts the next "0 bytes free" incident. `null` when the read did not
 * answer or no device has reported, which the caller renders as `unknown`
 * (never `0 B`, never green).
 */
export function tightestVolume(fetched: VolumesFetch): VolumeReading | null {
  if (fetched.state !== "ok") return null;
  let worst: VolumeReading | null = null;
  for (const entry of fetched.byDevice.values()) {
    for (const v of entry.volumes) {
      if (!Number.isFinite(v.free_bytes)) continue;
      if (worst === null || v.free_bytes < worst.free_bytes) worst = v;
    }
  }
  return worst;
}
