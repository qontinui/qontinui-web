import { describe, it, expect } from "vitest";
import {
  DEVICE_VOLUMES_NOT_YET_READ,
  groupFlatRows,
  indexDeviceVolumes,
  parseDeviceVolumes,
  parseFleetVolumes,
  resolveDeviceVolumes,
  resolveMachineVolumes,
  tightestVolume,
  toVolumeReading,
  volumesReliabilityWarning,
  VOLUMES_NOT_YET_READ,
} from "./fleetVolumes";
import type { DeviceStatus, DeviceVolumes } from "./types";

/**
 * Disk monitoring Phase 1 (plan
 * `2026-08-07-product-disk-monitoring-and-cleanup.md`).
 *
 * These tests pin the honesty rules, which are the point of the phase:
 * a read that failed and a device that genuinely has no telemetry must never
 * produce the same state, and no path may manufacture a zero.
 */

const DEVICE = "11111111-1111-1111-1111-111111111111";

/**
 * The devices a payload parsed to, or `null` when it was unparseable.
 *
 * Most assertions below care only about that distinction; the tests that care
 * about the PARTIAL case call `parseFleetVolumes` directly and read
 * `skippedRows`.
 */
function devicesOf(payload: unknown): DeviceVolumes[] | null {
  const parsed = parseFleetVolumes(payload);
  return parsed.state === "parsed" ? parsed.devices : null;
}

function activity(deviceId: string): DeviceStatus {
  return {
    device_id: deviceId,
    hostname: "box-1",
    current_task: null,
    current_repo: null,
    current_branch: null,
    free_text: null,
    details: {},
    tenant_id: null,
    updated_at: new Date().toISOString(),
  };
}

describe("parseFleetVolumes", () => {
  it("parses the grouped envelope", () => {
    const parsed = devicesOf({
      devices: [
        {
          device_id: DEVICE,
          hostname: "box-1",
          volumes: [
            {
              volume: "D:",
              total_bytes: 100,
              free_bytes: 10,
              observed_at: "2026-08-16T10:00:00Z",
            },
          ],
        },
      ],
      count: 1,
    });
    expect(parsed).toEqual([
      {
        device_id: DEVICE,
        hostname: "box-1",
        volumes: [
          {
            volume: "D:",
            total_bytes: 100,
            free_bytes: 10,
            observed_at: "2026-08-16T10:00:00Z",
          },
        ],
      },
    ]);
  });

  it("parses the flat oplog envelope and groups by device", () => {
    const parsed = devicesOf({
      volumes: [
        { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
        { device_id: DEVICE, volume: "D:", total_bytes: 4, free_bytes: 3 },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].volumes.map((v) => v.volume)).toEqual(["C:", "D:"]);
  });

  it("parses a bare array in either shape", () => {
    expect(devicesOf([{ device_id: DEVICE, volumes: [] }])).toHaveLength(1);
    expect(
      devicesOf([
        { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
      ])
    ).toHaveLength(1);
  });

  it("returns null — NOT an empty list — for an unrecognized payload", () => {
    // The distinction is the whole point: an empty list would render as "no
    // device has any disk", which is a claim the payload does not support.
    expect(devicesOf({ unexpected: true })).toBeNull();
    expect(devicesOf("nope")).toBeNull();
    expect(devicesOf(null)).toBeNull();
  });

  // -- W2: a RECOGNISED shape carrying an empty population ------------------
  //
  // `{devices: [], count: 0}` is the documented grouped envelope for a fleet
  // where nobody has reported yet. Reporting it as "did not match any known
  // shape" is factually false about a well-formed response and sends an
  // operator hunting a parse bug that does not exist. It must parse to `[]`,
  // and `[]` must mean the same thing in EVERY envelope — otherwise one fact
  // classifies as a failed read in one serialization and a device fact in
  // another.
  it("treats an EMPTY grouped envelope as a recognised, empty fleet", () => {
    expect(devicesOf({ devices: [], count: 0 })).toEqual([]);
    expect(devicesOf({ devices: [] })).toEqual([]);
  });

  it("treats an EMPTY flat envelope as a recognised, empty fleet", () => {
    expect(devicesOf({ volumes: [] })).toEqual([]);
  });

  it("treats a bare empty array as a recognised, empty fleet", () => {
    expect(devicesOf([])).toEqual([]);
  });

  // -- W1: a non-empty payload that yields no devices is UNPARSEABLE --------
  //
  // The failure mode this pins is the worst one available: `[]` is not
  // `null`, so the fetch succeeds, the maps come back empty, and EVERY machine
  // in the fleet renders "this device has never reported disk telemetry" —
  // a positive factual claim about every device, derived from a payload that
  // never supported it. Since coord's routes did not exist when the parser was
  // written, an envelope mismatch on integration day is the EXPECTED case.
  it("returns null — not an empty fleet — for camelCase flat rows", () => {
    expect(
      devicesOf({
        volumes: [
          { deviceId: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
        ],
      })
    ).toBeNull();
  });

  it("returns null when the PER-DEVICE envelope is fed to the fleet parser", () => {
    // `GET /devices/{id}/volumes` answers `{device_id, volumes: [...]}`; its
    // rows carry no `device_id` of their own. Diagnosing that as "no device
    // has ever reported" instead of "we could not parse the answer" is the
    // exact inversion this test forbids.
    expect(
      devicesOf({
        device_id: DEVICE,
        volumes: [
          { volume: "C:", total_bytes: 2, free_bytes: 1 },
          { volume: "D:", total_bytes: 4, free_bytes: 3 },
        ],
      })
    ).toBeNull();
  });

  it("returns null when device_id is serialized as a non-string", () => {
    expect(
      devicesOf({
        volumes: [
          { device_id: 42, volume: "C:", total_bytes: 2, free_bytes: 1 },
        ],
      })
    ).toBeNull();
    expect(
      devicesOf({
        volumes: [
          { device_id: null, volume: "C:", total_bytes: 2, free_bytes: 1 },
        ],
      })
    ).toBeNull();
  });

  it("returns null for a bare array of rows that name no device", () => {
    expect(
      devicesOf([{ volume: "C:", total_bytes: 2, free_bytes: 1 }])
    ).toBeNull();
  });

  it("returns null for a non-empty devices array with no usable entry", () => {
    expect(devicesOf({ devices: [{ deviceId: DEVICE }] })).toBeNull();
    expect(
      devicesOf({ devices: [{ device_id: DEVICE }], count: 1 })
    ).toBeNull();
  });

  it("still parses a payload where SOME rows are usable", () => {
    // Tolerance is preserved: a partially-readable payload is not thrown away.
    const parsed = devicesOf({
      volumes: [
        { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
        { deviceId: DEVICE, volume: "Z:", total_bytes: 2, free_bytes: 1 },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].volumes.map((v) => v.volume)).toEqual(["C:"]);
  });

  // -- W1 residual: a PARTIALLY readable payload -----------------------------
  //
  // Dropping the unreadable rows and keeping the rest is right (partial data is
  // worth showing) — but it silently shrinks the device list, and every device
  // that fell out then renders `never_reported`. That is the SAME fabricated
  // claim W1 was raised for, just narrower. So the parse now reports what it
  // skipped, and the count travels with the successful result.
  it("reports unattributable skipped rows alongside the readable half", () => {
    const parsed = parseFleetVolumes({
      volumes: [
        { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
        { deviceId: DEVICE, volume: "Z:", total_bytes: 2, free_bytes: 1 },
        { volume: "Y:", total_bytes: 2, free_bytes: 1 },
      ],
    });
    expect(parsed.state).toBe("parsed");
    expect(parsed.state === "parsed" && parsed.devices).toHaveLength(1);
    expect(parsed.state === "parsed" && parsed.skippedRows).toBe(2);
  });

  it("attributes a device's OWN unreadable rows to that device", () => {
    // These rows named the device, so the drop is attributable: the device is
    // kept with the drop recorded, rather than vanishing from the map where
    // its absence would read as "never reported".
    const parsed = parseFleetVolumes({
      devices: [
        { device_id: DEVICE, hostname: "box-1", volumes: [{ nope: true }, {}] },
      ],
    });
    expect(parsed.state === "parsed" && parsed.skippedRows).toBe(0);
    const devices = parsed.state === "parsed" ? parsed.devices : [];
    expect(devices).toHaveLength(1);
    expect(devices[0].volumes).toEqual([]);
    expect(devices[0].skipped_rows).toBe(2);
  });

  it("keeps a grouped entry with no volumes array as UNREADABLE, not absent", () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const parsed = parseFleetVolumes({
      devices: [
        {
          device_id: DEVICE,
          volumes: [
            { volume: "C:", total_bytes: 2, free_bytes: 1, observed_at: null },
          ],
        },
        { device_id: OTHER },
      ],
      count: 2,
    });
    const devices = parsed.state === "parsed" ? parsed.devices : [];
    expect(devices).toHaveLength(2);
    const other = devices.find((d) => d.device_id === OTHER);
    expect(other?.volumes).toEqual([]);
    expect(other?.skipped_rows).toBe(1);
  });

  it("attributes a flat row that named a device but no usable volume", () => {
    const { devices, rejected } = groupFlatRows([
      { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
      { device_id: DEVICE, total_bytes: 9 },
    ]);
    expect(rejected).toBe(0);
    expect(devices).toHaveLength(1);
    expect(devices[0].skipped_rows).toBe(1);
    expect(devices[0].volumes.map((v) => v.volume)).toEqual(["C:"]);
  });

  it("counts rejected rows so an empty result can be told from a failed one", () => {
    expect(groupFlatRows([])).toEqual({ devices: [], rejected: 0 });
    expect(groupFlatRows([{ volume: "D:" }, "junk", null])).toEqual({
      devices: [],
      rejected: 3,
    });
    const ok = groupFlatRows([
      { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
      { volume: "no-device" },
    ]);
    expect(ok.devices).toHaveLength(1);
    expect(ok.rejected).toBe(1);
  });

  it("never coerces a missing byte count to zero", () => {
    const reading = toVolumeReading({ volume: "D:", observed_at: null });
    expect(reading).not.toBeNull();
    expect(Number.isNaN(reading!.free_bytes)).toBe(true);
    expect(Number.isNaN(reading!.total_bytes)).toBe(true);
    expect(reading!.free_bytes).not.toBe(0);
  });

  it("drops rows with no usable volume identity", () => {
    expect(toVolumeReading({ total_bytes: 1, free_bytes: 1 })).toBeNull();
    expect(toVolumeReading({ volume: "" })).toBeNull();
    expect(groupFlatRows([{ volume: "D:" }]).devices).toEqual([]);
  });
});

describe("resolveMachineVolumes", () => {
  const fetched = indexDeviceVolumes([
    {
      device_id: DEVICE,
      hostname: "box-1",
      volumes: [
        {
          volume: "D:",
          total_bytes: 100,
          free_bytes: 10,
          observed_at: "2026-08-16T10:00:00Z",
        },
      ],
    },
  ]);

  it("joins by device_id", () => {
    const state = resolveMachineVolumes("box-1", activity(DEVICE), fetched);
    expect(state.state).toBe("reported");
    expect(state.state === "reported" && state.volumes).toHaveLength(1);
  });

  it("falls back to hostname when no device_status row is in view", () => {
    const state = resolveMachineVolumes("box-1", undefined, fetched);
    expect(state.state).toBe("reported");
  });

  it("reports never_reported for a device the SUCCESSFUL read did not cover", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const state = resolveMachineVolumes("box-2", activity(other), fetched);
    expect(state).toEqual({ state: "never_reported", deviceId: other });
  });

  it("reports never_reported for a device that returned an EMPTY volume list", () => {
    const empty = indexDeviceVolumes([
      { device_id: DEVICE, hostname: "box-1", volumes: [] },
    ]);
    const state = resolveMachineVolumes("box-1", activity(DEVICE), empty);
    expect(state).toEqual({ state: "never_reported", deviceId: DEVICE });
  });

  it("reports unknown WITH the read's reason when the read failed", () => {
    const state = resolveMachineVolumes("box-1", activity(DEVICE), {
      state: "unavailable",
      reason: "HTTP 502 from coord",
    });
    expect(state.state).toBe("unknown");
    expect(state.state === "unknown" && state.reason).toContain("HTTP 502");
  });

  it("never turns a failed read into a claim about the device", () => {
    const state = resolveMachineVolumes("box-9", undefined, {
      state: "unavailable",
      reason: "coord unreachable",
    });
    expect(state.state).toBe("unknown");
    expect(state.state === "unknown" && state.reason).not.toMatch(
      /never reported/i
    );
  });

  it("reports unknown — not never_reported — for an unidentifiable machine", () => {
    const state = resolveMachineVolumes("ghost-host", undefined, fetched);
    expect(state.state).toBe("unknown");
    expect(state.state === "unknown" && state.reason).toMatch(
      /could not be matched to a device|no coord device row/i
    );
  });

  it("starts unavailable before the first read completes", () => {
    const state = resolveMachineVolumes(
      "box-1",
      activity(DEVICE),
      VOLUMES_NOT_YET_READ
    );
    expect(state.state).toBe("unknown");
  });
});

/**
 * The MIXED payload — the residual left by the first W1 fix.
 *
 * Some rows parse, some do not. The readable half must survive (partial data
 * is worth showing), but the page must stop making a positive claim about the
 * half it could not read: no machine may render a bare `never_reported`, and
 * the unreliability must be stated where the operator sees it.
 */
describe("partially readable fleet-volumes payloads", () => {
  const OTHER = "22222222-2222-2222-2222-222222222222";

  // One good device, one row naming a device in an unreadable (camelCase)
  // form, one row naming no device at all.
  const MIXED = {
    volumes: [
      {
        device_id: DEVICE,
        hostname: "box-1",
        volume: "D:",
        total_bytes: 100,
        free_bytes: 10,
        observed_at: "2026-08-16T10:00:00Z",
      },
      { deviceId: OTHER, volume: "C:", total_bytes: 2, free_bytes: 1 },
      { volume: "E:", total_bytes: 2, free_bytes: 1 },
    ],
  };

  function fetchMixed() {
    const parsed = parseFleetVolumes(MIXED);
    if (parsed.state !== "parsed") throw new Error("expected a parsed payload");
    return indexDeviceVolumes(parsed.devices, parsed.skippedRows);
  }

  it("keeps the readable device and renders its real volumes", () => {
    const state = resolveMachineVolumes(
      "box-1",
      activity(DEVICE),
      fetchMixed()
    );
    expect(state.state).toBe("reported");
    expect(
      state.state === "reported" && state.volumes.map((v) => v.volume)
    ).toEqual(["D:"]);
  });

  it("does NOT claim never_reported for a device the skipped rows may cover", () => {
    const state = resolveMachineVolumes("box-2", activity(OTHER), fetchMixed());
    expect(state.state).not.toBe("never_reported");
    expect(state.state).toBe("unknown");
    expect(state.state === "unknown" && state.reason).toMatch(
      /partly readable/i
    );
    expect(state.state === "unknown" && state.reason).toMatch(
      /named no device/i
    );
  });

  it("surfaces a fleet-level warning that the never-reported labels are unreliable", () => {
    const warning = volumesReliabilityWarning(fetchMixed());
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/2 rows/);
    expect(warning).toMatch(/PARTLY/);
    expect(warning).toMatch(/UNRELIABLE/);
  });

  it("says nothing when the read was WHOLE — no warning, never_reported stands", () => {
    const parsed = parseFleetVolumes({
      devices: [
        {
          device_id: DEVICE,
          hostname: "box-1",
          volumes: [
            {
              volume: "D:",
              total_bytes: 100,
              free_bytes: 10,
              observed_at: null,
            },
          ],
        },
      ],
      count: 1,
    });
    const fetched =
      parsed.state === "parsed"
        ? indexDeviceVolumes(parsed.devices, parsed.skippedRows)
        : null;
    expect(fetched).not.toBeNull();
    expect(volumesReliabilityWarning(fetched!)).toBeNull();
    // The honest never_reported verdict is NOT collateral damage of the fix:
    // a whole read still supports it.
    expect(resolveMachineVolumes("box-2", activity(OTHER), fetched!)).toEqual({
      state: "never_reported",
      deviceId: OTHER,
    });
  });

  it("never warns about a read that did not answer at all", () => {
    // That is `unavailable`, which already carries its own reason — the
    // partial-read warning must not double-report it as a partial success.
    expect(volumesReliabilityWarning(VOLUMES_NOT_YET_READ)).toBeNull();
  });

  it("blames the READ, not the device, when all of a device's own rows drop", () => {
    const parsed = parseFleetVolumes({
      devices: [
        { device_id: DEVICE, hostname: "box-1", volumes: [{ bogus: true }] },
      ],
    });
    const fetched =
      parsed.state === "parsed"
        ? indexDeviceVolumes(parsed.devices, parsed.skippedRows)
        : null;
    const state = resolveMachineVolumes("box-1", activity(DEVICE), fetched!);
    expect(state.state).toBe("unknown");
    expect(state.state === "unknown" && state.reason).toMatch(
      /could not be read/i
    );
    expect(state.state === "unknown" && state.reason).toMatch(/DID report/);
  });
});

describe("tightestVolume", () => {
  it("returns the smallest free-space reading across the fleet", () => {
    const fetched = indexDeviceVolumes([
      {
        device_id: DEVICE,
        volumes: [
          { volume: "C:", total_bytes: 100, free_bytes: 50, observed_at: null },
          { volume: "D:", total_bytes: 100, free_bytes: 5, observed_at: null },
        ],
      },
      {
        device_id: "33333333-3333-3333-3333-333333333333",
        volumes: [
          { volume: "E:", total_bytes: 100, free_bytes: 20, observed_at: null },
        ],
      },
    ]);
    expect(tightestVolume(fetched)?.volume).toBe("D:");
  });

  it("skips non-numeric readings rather than treating them as zero", () => {
    const fetched = indexDeviceVolumes([
      {
        device_id: DEVICE,
        volumes: [
          {
            volume: "C:",
            total_bytes: Number.NaN,
            free_bytes: Number.NaN,
            observed_at: null,
          },
          { volume: "D:", total_bytes: 100, free_bytes: 7, observed_at: null },
        ],
      },
    ]);
    expect(tightestVolume(fetched)?.volume).toBe("D:");
  });

  it("returns null (→ unknown) when the read did not answer", () => {
    expect(tightestVolume(VOLUMES_NOT_YET_READ)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-device sibling (Phase 2 — `deviceVolumesUrl`'s first consumer)
// ---------------------------------------------------------------------------

describe("parseDeviceVolumes", () => {
  it("parses the per-device envelope the fleet parser cannot", () => {
    const parsed = parseDeviceVolumes({
      device_id: DEVICE,
      volumes: [
        {
          volume: "D:",
          total_bytes: 100,
          free_bytes: 7,
          observed_at: "2026-08-16T00:00:00Z",
        },
      ],
    });
    expect(parsed.state).toBe("parsed");
    if (parsed.state !== "parsed") return;
    expect(parsed.deviceId).toBe(DEVICE);
    expect(parsed.volumes).toHaveLength(1);
    expect(parsed.skippedRows).toBe(0);
    // The regression this parser exists for: the FLEET parser rejects this
    // exact (valid) payload because its rows carry no `device_id`.
    expect(parseFleetVolumes({ device_id: DEVICE, volumes: [] }).state).toBe(
      "parsed"
    );
  });

  it("reads an EMPTY volumes array as a recognised shape, not a failure", () => {
    const parsed = parseDeviceVolumes({ device_id: DEVICE, volumes: [] });
    expect(parsed.state).toBe("parsed");
    if (parsed.state !== "parsed") return;
    expect(parsed.volumes).toEqual([]);
    expect(parsed.skippedRows).toBe(0);
  });

  it("is UNPARSEABLE when there is no volumes array", () => {
    const parsed = parseDeviceVolumes({ device_id: DEVICE });
    expect(parsed.state).toBe("unparseable");
    if (parsed.state !== "unparseable") return;
    expect(parsed.reason).toMatch(/not an empty one/i);
  });

  it("is UNPARSEABLE for a non-object payload", () => {
    expect(parseDeviceVolumes(null).state).toBe("unparseable");
    expect(parseDeviceVolumes([]).state).toBe("unparseable");
  });

  it("counts unreadable rows instead of dropping them", () => {
    const parsed = parseDeviceVolumes({
      device_id: DEVICE,
      volumes: [{ volume: "D:", total_bytes: 1, free_bytes: 1 }, {}, 7],
    });
    expect(parsed.state).toBe("parsed");
    if (parsed.state !== "parsed") return;
    expect(parsed.volumes).toHaveLength(1);
    expect(parsed.skippedRows).toBe(2);
  });

  it("keeps a non-numeric byte count as NaN, never 0", () => {
    const parsed = parseDeviceVolumes({
      device_id: DEVICE,
      volumes: [{ volume: "D:", total_bytes: null, free_bytes: "lots" }],
    });
    if (parsed.state !== "parsed") throw new Error("expected parsed");
    expect(Number.isNaN(parsed.volumes[0].free_bytes)).toBe(true);
    expect(parsed.volumes[0].free_bytes).not.toBe(0);
  });
});

describe("resolveDeviceVolumes", () => {
  const reading = {
    volume: "D:",
    total_bytes: 100,
    free_bytes: 7,
    observed_at: null,
  };

  it("reports readable volumes", () => {
    const state = resolveDeviceVolumes(
      { state: "ok", deviceId: DEVICE, volumes: [reading], skippedRows: 0 },
      DEVICE
    );
    expect(state.state).toBe("reported");
  });

  it("says never_reported ONLY for a clean, empty, successful read", () => {
    const state = resolveDeviceVolumes(
      { state: "ok", deviceId: DEVICE, volumes: [], skippedRows: 0 },
      DEVICE
    );
    expect(state.state).toBe("never_reported");
  });

  it("says UNKNOWN — not never_reported — when rows were dropped", () => {
    const state = resolveDeviceVolumes(
      { state: "ok", deviceId: DEVICE, volumes: [], skippedRows: 2 },
      DEVICE
    );
    expect(state.state).toBe("unknown");
    if (state.state !== "unknown") return;
    expect(state.reason).toMatch(/could not be read/i);
    expect(state.reason).toMatch(/not zero/i);
  });

  it("carries the failure reason through, never an empty list", () => {
    const state = resolveDeviceVolumes(
      { state: "unavailable", reason: "coord returned HTTP 502" },
      DEVICE
    );
    expect(state).toEqual({
      state: "unknown",
      reason: "coord returned HTTP 502",
    });
  });

  it("refuses to attribute another device's answer to this machine", () => {
    const state = resolveDeviceVolumes(
      { state: "ok", deviceId: "other", volumes: [reading], skippedRows: 0 },
      DEVICE
    );
    expect(state.state).toBe("unknown");
    if (state.state !== "unknown") return;
    expect(state.reason).toMatch(/answered for device other/i);
  });

  it("accepts a response that named no device at all", () => {
    const state = resolveDeviceVolumes(
      { state: "ok", deviceId: null, volumes: [reading], skippedRows: 0 },
      DEVICE
    );
    expect(state.state).toBe("reported");
  });

  it("starts UNKNOWN before the first read", () => {
    expect(
      resolveDeviceVolumes(DEVICE_VOLUMES_NOT_YET_READ, DEVICE).state
    ).toBe("unknown");
  });
});
