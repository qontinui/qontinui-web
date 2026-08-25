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
      /**
       * Rows in the response that named NO device and were skipped.
       *
       * `> 0` means this read was only PARTLY readable, and — because the
       * skipped rows named no device — any machine on the page could be one
       * they belonged to. Every `never_reported` verdict from this fetch is
       * therefore unreliable and must be downgraded to UNKNOWN.
       */
      skippedRows: number;
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

/**
 * What {@link groupFlatRows} made of a flat row list.
 *
 * `rejected` is load-bearing, not diagnostics: a flat array whose rows the
 * grouper could not use (camelCase `deviceId`, a non-string `device_id`, the
 * per-device envelope's rows which carry no device identity at all) would
 * otherwise produce an EMPTY device list from a NON-EMPTY payload — and an
 * empty list is a positive claim that no device has ever reported. The count
 * is what lets {@link parseFleetVolumes} tell "nobody reported" apart from
 * "we could not read the answer".
 *
 * It counts ONLY the rows that named no device, because those are the ones
 * that cannot be attributed. A row that named a device but carried no usable
 * volume is recorded on THAT device's `skipped_rows` instead, which is a
 * sharper answer than a fleet-wide caveat.
 */
export interface FlatGroupResult {
  devices: DeviceVolumes[];
  /**
   * Rows that named NO device (non-record, or a missing/non-string
   * `device_id`). UNATTRIBUTABLE: any machine on the page could be the one
   * they belonged to, so their existence makes every `never_reported` verdict
   * in this fetch unreliable.
   */
  rejected: number;
}

/** Group flat `VolumeRow`s (`{device_id, volume, ...}`) by device. */
export function groupFlatRows(rows: unknown[]): FlatGroupResult {
  const byDevice = new Map<string, DeviceVolumes>();
  let rejected = 0;
  for (const row of rows) {
    if (!isRecord(row)) {
      rejected++;
      continue;
    }
    const deviceId = row.device_id;
    if (typeof deviceId !== "string") {
      rejected++;
      continue;
    }
    let entry = byDevice.get(deviceId);
    if (!entry) {
      entry = {
        device_id: deviceId,
        hostname: typeof row.hostname === "string" ? row.hostname : null,
        volumes: [],
      };
      byDevice.set(deviceId, entry);
    }
    // The row NAMED this device, so a failure to read it is attributable: the
    // device gets an entry with a skip recorded rather than being left out of
    // the map entirely, where its absence would read as "never reported".
    const reading = toVolumeReading(row);
    if (!reading) {
      entry.skipped_rows = (entry.skipped_rows ?? 0) + 1;
      continue;
    }
    entry.volumes.push(reading);
  }
  return { devices: Array.from(byDevice.values()), rejected };
}

/**
 * The outcome of {@link parseFleetVolumes}.
 *
 * `skippedRows` rides along with a SUCCESSFUL parse because a partial payload
 * is still worth showing — the fix for it is not to throw the readable half
 * away, but to stop the UI making a positive claim it cannot support about the
 * unreadable half. It counts only UNATTRIBUTABLE drops (rows that named no
 * device); per-device drops live on that device's `skipped_rows`.
 */
export type FleetVolumesParse =
  | { state: "parsed"; devices: DeviceVolumes[]; skippedRows: number }
  | { state: "unparseable" };

/**
 * Decide what a flat row list means.
 *
 * A non-empty row list that produced ZERO devices is UNPARSEABLE, never an
 * empty fleet: the payload said something, and we failed to read it. Returning
 * an empty device list there would render every machine as `never_reported` —
 * "no device has ever reported disk telemetry" — a positive factual claim about
 * the whole fleet derived from a payload that never supported it. The expected
 * trigger is an envelope mismatch on the day coord's routes land (camelCase
 * `deviceId`, a non-string `device_id`, or the per-device
 * `{device_id, volumes: [...]}` envelope whose rows carry no device identity),
 * and the honest diagnosis of that is "we could not parse the answer", not
 * "nobody reported".
 */
function fromFlatRows(rows: unknown[]): FleetVolumesParse {
  // A present-but-empty array is a RECOGNISED shape: the read answered, and
  // the answer is that nothing has reported yet.
  if (rows.length === 0)
    return { state: "parsed", devices: [], skippedRows: 0 };
  const { devices, rejected } = groupFlatRows(rows);
  if (devices.length === 0 && rejected > 0) return { state: "unparseable" };
  return { state: "parsed", devices, skippedRows: rejected };
}

/**
 * Normalize the fleet-volumes payload.
 *
 * The PREFERRED shape is coord's grouped envelope
 * (`{devices: [{device_id, hostname?, volumes[]}], count}`) — that is what the
 * route serves, and `hostname` is kept as a join key. The flat oplog shape
 * (`{volumes: [{device_id, volume, ...}]}`) and a bare array of either remain
 * as a TOLERANT FALLBACK: coord's `VolumeRow` carries `device_id` on every
 * row, so both are plausible serializations and the dashboard should not blank
 * out because the envelope differs.
 *
 * Three outcomes, and the difference between them is the whole point:
 *
 * - `parsed` with devices — the read answered and named devices. It may ALSO
 *   carry `skippedRows > 0`, meaning the answer was only partly readable; the
 *   readable half is kept (tolerance), and the caller must then refuse to
 *   claim `never_reported` about anything (see {@link resolveMachineVolumes}).
 * - `parsed` with NO devices and `skippedRows: 0` — a RECOGNISED shape
 *   carrying an EMPTY population: `{devices: []}`, `{volumes: []}` or `[]`. A
 *   fleet where nobody has reported yet is a fact about the fleet, and
 *   reporting it as a parse failure would send an operator hunting a bug that
 *   does not exist.
 * - `unparseable` — the payload matched no known shape, OR a non-empty row
 *   array yielded zero devices (see {@link fromFlatRows}). The caller renders
 *   UNKNOWN with the reason.
 */
export function parseFleetVolumes(payload: unknown): FleetVolumesParse {
  const container = isRecord(payload) ? payload : null;
  const grouped = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.devices)
      ? (container.devices as unknown[])
      : null;

  if (grouped) {
    const out: DeviceVolumes[] = [];
    // Entries that NAMED a device but carried no `volumes` array. They are
    // attributable, so they are kept as devices whose rows we could not read
    // rather than dropped — but only once some other entry has proved this is
    // the grouped envelope at all (otherwise a bare array of FLAT rows would
    // be misread as a fleet of volume-less devices).
    const unreadable: DeviceVolumes[] = [];
    let sawGrouped = false;
    let unattributable = 0;
    for (const entry of grouped) {
      if (!isRecord(entry)) {
        unattributable++;
        continue;
      }
      const deviceId = entry.device_id;
      if (typeof deviceId !== "string") {
        unattributable++;
        continue;
      }
      const hostname =
        typeof entry.hostname === "string" ? entry.hostname : null;
      if (!Array.isArray(entry.volumes)) {
        unreadable.push({
          device_id: deviceId,
          hostname,
          volumes: [],
          skipped_rows: 1,
        });
        continue;
      }
      sawGrouped = true;
      const rows = entry.volumes as unknown[];
      const volumes = rows
        .map(toVolumeReading)
        .filter((v): v is VolumeReading => v !== null);
      // Rows this device named but we could not read. Without the count, a
      // device whose every row was unreadable arrives here as `volumes: []`
      // and renders as "never reported" — the same fabricated claim, per
      // device instead of per fleet.
      const dropped = rows.length - volumes.length;
      out.push({
        device_id: deviceId,
        hostname,
        volumes,
        ...(dropped > 0 ? { skipped_rows: dropped } : {}),
      });
    }
    if (sawGrouped) {
      return {
        state: "parsed",
        devices: [...out, ...unreadable],
        skippedRows: unattributable,
      };
    }
    // A present-but-EMPTY `devices` array (or a bare `[]`) is the documented
    // grouped envelope for a fleet where nobody has reported yet -- a
    // recognised shape describing an empty population, NOT a parse failure.
    if (grouped.length === 0) {
      return { state: "parsed", devices: [], skippedRows: 0 };
    }
    // A bare array of FLAT rows falls through to the flat grouping.
    if (Array.isArray(payload)) return fromFlatRows(payload);
    // A non-empty `devices` array in which no entry carried both a string
    // `device_id` and a `volumes` array is unreadable, not empty.
    return { state: "unparseable" };
  }

  if (container && Array.isArray(container.volumes)) {
    return fromFlatRows(container.volumes as unknown[]);
  }
  return { state: "unparseable" };
}

/**
 * Build the lookup maps a {@link VolumesFetch} `ok` state carries.
 *
 * `skippedRows` is the UNATTRIBUTABLE drop count from the parse. It defaults to
 * zero only so hand-built test fixtures stay terse — production callers pass
 * the parse's own number, because dropping it on the floor here would restore
 * the exact defect it exists to prevent.
 */
export function indexDeviceVolumes(
  entries: DeviceVolumes[],
  skippedRows = 0
): VolumesFetch {
  const byDevice = new Map<string, DeviceVolumes>();
  const byHostname = new Map<string, DeviceVolumes>();
  for (const entry of entries) {
    byDevice.set(entry.device_id, entry);
    if (entry.hostname) byHostname.set(entry.hostname, entry);
  }
  return { state: "ok", byDevice, byHostname, skippedRows };
}

/**
 * The fleet-level warning for a PARTLY readable response, or `null` when the
 * read was whole.
 *
 * This is not a footnote. The skipped rows named no device, so they could have
 * belonged to any machine on the page — which makes every "never reported"
 * label in this render a claim the data does not support. The text says that
 * outright rather than leaving the operator to infer it.
 */
export function volumesReliabilityWarning(
  fetched: VolumesFetch
): string | null {
  if (fetched.state !== "ok" || fetched.skippedRows === 0) return null;
  const n = fetched.skippedRows;
  return (
    `${n} row${n === 1 ? "" : "s"} in the fleet-volumes response named no ` +
    `device and could not be attributed, so this read is only PARTLY ` +
    `readable. Disk telemetry shown below is real, but the machines marked ` +
    `as having no telemetry are UNRELIABLE for this refresh -- some of them ` +
    `may have reported in the rows that were skipped.`
  );
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
  fetched: VolumesFetch,
  /**
   * A device id learned from somewhere OTHER than `device_status` — coord's
   * `/fleet/health` row for this machine, on a list built with that read
   * merged in. Used only when `activity` carries none: a machine coord names
   * but that has posted no device-status row could otherwise be looked up by
   * hostname alone, and reported as "no coord device row in view" when there
   * plainly is one.
   */
  fallbackDeviceId?: string | null
): MachineVolumes {
  if (fetched.state !== "ok") {
    return { state: "unknown", reason: fetched.reason };
  }
  const deviceId = activity?.device_id ?? fallbackDeviceId ?? null;
  const entry =
    (deviceId ? fetched.byDevice.get(deviceId) : undefined) ??
    fetched.byHostname.get(hostname);

  // A partly-readable response cannot support `never_reported` about ANY
  // machine: the rows it dropped named no device, so one of them may well have
  // been this machine's. The readable half is still shown (tolerance) -- what
  // is withdrawn is the claim about the unreadable half.
  const partial = fetched.skippedRows > 0;
  const partialReason =
    `The fleet-volumes read was only PARTLY readable: ${fetched.skippedRows} ` +
    `row${fetched.skippedRows === 1 ? "" : "s"} named no device and had to be ` +
    `skipped, and any of them could have been this machine's. So this is NOT ` +
    `"never reported" -- it is "we could not read the whole answer".`;

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
    if (partial) return { state: "unknown", reason: partialReason };
    return { state: "never_reported", deviceId };
  }
  if (entry.volumes.length === 0) {
    // Attributed drops: coord DID name this device, and we failed to read the
    // rows it named. That is a fact about the read, not about the device.
    const dropped = entry.skipped_rows ?? 0;
    if (dropped > 0) {
      return {
        state: "unknown",
        reason:
          `Coord returned ${dropped} volume row${dropped === 1 ? "" : "s"} ` +
          `for this device that could not be read, and no readable row ` +
          `survived. The device DID report -- we could not parse what it ` +
          `reported -- so this is not "never reported" and not zero.`,
      };
    }
    if (partial) return { state: "unknown", reason: partialReason };
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

// ---------------------------------------------------------------------------
// Per-device sibling — `GET /operations/devices/{device_id}/volumes`
//
// Plan `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 2 step 4.
// Phase 1 shipped the route and `deviceVolumesUrl()` with NO caller; the Disk
// section of `/settings/storage` is the first consumer.
//
// This needs its OWN parser rather than reusing `parseFleetVolumes`. The
// per-device envelope is `{device_id, volumes: [{volume, ...}]}` — its rows
// carry no `device_id` of their own, so the fleet parser's flat-row grouper
// rejects every one of them and reports `unparseable`. Feeding a valid
// per-device response through the fleet parser would therefore render a
// working device as "could not read" forever.
// ---------------------------------------------------------------------------

/** What a per-device volumes read produced. */
export type DeviceVolumesFetch =
  | {
      state: "ok";
      /** `device_id` the response named, or `null` when it named none. */
      deviceId: string | null;
      volumes: VolumeReading[];
      /** Rows this device named that could not be read. */
      skippedRows: number;
    }
  | { state: "unavailable"; reason: string };

/** The pre-first-read state. Deliberately `unavailable`, not an empty "ok". */
export const DEVICE_VOLUMES_NOT_YET_READ: DeviceVolumesFetch = {
  state: "unavailable",
  reason:
    "This device's disk telemetry has not been read yet -- the first " +
    "per-device volumes request has not completed.",
};

export type DeviceVolumesParse =
  | {
      state: "parsed";
      deviceId: string | null;
      volumes: VolumeReading[];
      skippedRows: number;
    }
  | { state: "unparseable"; reason: string };

/**
 * Normalize the per-device volumes payload.
 *
 * A response with a `volumes` array is READABLE even when the array is empty —
 * that is the documented shape for a device that has never reported, and the
 * caller renders it as `never_reported` (a fact about the device). A response
 * WITHOUT a `volumes` array is unreadable, which is a fact about the read.
 *
 * Rows that carry no usable volume identity are counted, never dropped
 * silently: a device whose every row was unreadable arrives here with an empty
 * `volumes` list, and without the count it is indistinguishable from a device
 * that never reported at all.
 */
export function parseDeviceVolumes(payload: unknown): DeviceVolumesParse {
  if (!isRecord(payload)) {
    return {
      state: "unparseable",
      reason:
        "The per-device volumes response was not a JSON object, so no " +
        "reading could be taken from it.",
    };
  }
  if (!Array.isArray(payload.volumes)) {
    return {
      state: "unparseable",
      reason:
        "The per-device volumes response carried no `volumes` array " +
        "(expected `{device_id, volumes: [...]}`). That is an unreadable " +
        "answer, not an empty one -- it says nothing about this disk.",
    };
  }
  const rows = payload.volumes as unknown[];
  const volumes = rows
    .map(toVolumeReading)
    .filter((v): v is VolumeReading => v !== null);
  return {
    state: "parsed",
    deviceId: typeof payload.device_id === "string" ? payload.device_id : null,
    volumes,
    skippedRows: rows.length - volumes.length,
  };
}

/**
 * Resolve ONE device's telemetry into the same three-state union the fleet
 * cards use, so both surfaces render absence identically.
 *
 * `requestedDeviceId` is the device we ASKED about. When the response names a
 * different one, the answer is UNKNOWN rather than being attributed to this
 * machine — a mismatched row is somebody else's disk, and showing it here
 * would be a fabricated reading with the wrong provenance.
 */
export function resolveDeviceVolumes(
  fetched: DeviceVolumesFetch,
  requestedDeviceId: string
): MachineVolumes {
  if (fetched.state !== "ok") {
    return { state: "unknown", reason: fetched.reason };
  }
  if (fetched.deviceId !== null && fetched.deviceId !== requestedDeviceId) {
    return {
      state: "unknown",
      reason:
        `The volumes read answered for device ${fetched.deviceId}, but this ` +
        `machine is ${requestedDeviceId}. Nothing here describes THIS ` +
        `machine's disk, so no reading is shown.`,
    };
  }
  if (fetched.volumes.length > 0) {
    return {
      state: "reported",
      deviceId: requestedDeviceId,
      volumes: fetched.volumes,
    };
  }
  if (fetched.skippedRows > 0) {
    return {
      state: "unknown",
      reason:
        `Coord returned ${fetched.skippedRows} volume row` +
        `${fetched.skippedRows === 1 ? "" : "s"} for this device that could ` +
        `not be read, and no readable row survived. The device DID report -- ` +
        `we could not parse what it reported -- so this is not "never ` +
        `reported" and not zero.`,
    };
  }
  return { state: "never_reported", deviceId: requestedDeviceId };
}
