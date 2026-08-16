import { describe, it, expect } from "vitest";
import {
  groupFlatRows,
  indexDeviceVolumes,
  parseFleetVolumes,
  resolveMachineVolumes,
  tightestVolume,
  toVolumeReading,
  VOLUMES_NOT_YET_READ,
} from "./fleetVolumes";
import type { DeviceStatus } from "./types";

/**
 * Disk monitoring Phase 1 (plan
 * `2026-08-07-product-disk-monitoring-and-cleanup.md`).
 *
 * These tests pin the honesty rules, which are the point of the phase:
 * a read that failed and a device that genuinely has no telemetry must never
 * produce the same state, and no path may manufacture a zero.
 */

const DEVICE = "11111111-1111-1111-1111-111111111111";

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
    const parsed = parseFleetVolumes({
      volumes: [
        { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
        { device_id: DEVICE, volume: "D:", total_bytes: 4, free_bytes: 3 },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].volumes.map((v) => v.volume)).toEqual(["C:", "D:"]);
  });

  it("parses a bare array in either shape", () => {
    expect(
      parseFleetVolumes([{ device_id: DEVICE, volumes: [] }])
    ).toHaveLength(1);
    expect(
      parseFleetVolumes([
        { device_id: DEVICE, volume: "C:", total_bytes: 2, free_bytes: 1 },
      ])
    ).toHaveLength(1);
  });

  it("returns null — NOT an empty list — for an unrecognized payload", () => {
    // The distinction is the whole point: an empty list would render as "no
    // device has any disk", which is a claim the payload does not support.
    expect(parseFleetVolumes({ unexpected: true })).toBeNull();
    expect(parseFleetVolumes("nope")).toBeNull();
    expect(parseFleetVolumes(null)).toBeNull();
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
    expect(groupFlatRows([{ volume: "D:" }])).toEqual([]);
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
