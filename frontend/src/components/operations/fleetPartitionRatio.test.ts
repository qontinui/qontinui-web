/**
 * `fleetPartitionRatioLine` — coord's fleet-partition ratio on the Dev Ops
 * health strip. Every case is an honesty rule: no percentage over nothing,
 * none while coord says the ratio is unknown, and an absent block is UNKNOWN,
 * never 0.
 */

import { describe, expect, it } from "vitest";
import type { FleetPartitionRatio } from "@/lib/api/operations/coordFleet";
import { fleetPartitionRatioLine } from "./fleetPartitionRatio";

const ratio = (over: Partial<FleetPartitionRatio>): FleetPartitionRatio => ({
  scope: "tenant",
  partitioned: 0,
  eligible: 0,
  pct: null,
  known: true,
  fires: false,
  threshold_pct: 10,
  min_devices: 2,
  degradable_dropped: 0,
  ...over,
});

describe("fleetPartitionRatioLine", () => {
  it("says UNKNOWN with the withheld count when coord says known: false, never a percentage", () => {
    const line = fleetPartitionRatioLine({
      fleet_partition_ratio: ratio({
        known: false,
        partitioned: 1,
        eligible: 10,
        pct: null,
        degradable_dropped: 3,
      }),
    });
    expect(line?.label).toBe(
      "partition ratio UNKNOWN: coord withheld 3 degradable rows"
    );
    expect(line?.label).not.toMatch(/%/);
    expect(line?.tone).toBe("waiting");
  });

  it("says there are no heartbeating rows when eligible is 0, never 0%", () => {
    const line = fleetPartitionRatioLine({
      fleet_partition_ratio: ratio({ eligible: 0, partitioned: 0, pct: null }),
    });
    expect(line?.label).toBe(
      "partition ratio: no heartbeating rows (this tenant's machines)"
    );
    expect(line?.label).not.toMatch(/0%/);
    expect(line?.tone).toBe("muted");
  });

  it("renders a non-zero ratio as partitioned/eligible with coord's pct and its scope", () => {
    const line = fleetPartitionRatioLine({
      fleet_partition_ratio: ratio({ partitioned: 2, eligible: 40, pct: 5 }),
    });
    expect(line?.label).toBe(
      "2/40 heartbeating rows partitioned (5.0%) — this tenant's machines"
    );
    expect(line?.tone).toBe("muted");
    expect(line?.title).toContain("Coord alerts above 10%");
  });

  it("borrows red only when coord says the ratio fires", () => {
    const line = fleetPartitionRatioLine({
      fleet_partition_ratio: ratio({
        partitioned: 5,
        eligible: 20,
        pct: 25,
        fires: true,
        scope: "unscoped",
      }),
    });
    expect(line?.label).toBe(
      "5/20 heartbeating rows partitioned (25.0%) — every tenant's machines"
    );
    expect(line?.tone).toBe("attention");
  });

  it("reads an absent block as UNKNOWN, and renders nothing before any read", () => {
    const absent = fleetPartitionRatioLine({});
    expect(absent?.label).toBe(
      "partition ratio unknown — this coord does not serve it"
    );
    expect(absent?.label).not.toMatch(/\b0\b|0%/);
    expect(fleetPartitionRatioLine(null)).toBeNull();
  });

  it("reads a malformed count as UNKNOWN, never as zero", () => {
    const line = fleetPartitionRatioLine({
      fleet_partition_ratio: ratio({
        eligible: undefined,
        partitioned: 1,
      }),
    });
    expect(line?.label).toBe(
      "partition ratio unknown — coord's figure could not be read"
    );
  });
});
