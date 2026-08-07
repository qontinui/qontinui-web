/**
 * §C3 honesty rules, as executable assertions.
 *
 * Plan: `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C3. Each
 * `describe` below is one of that section's rules — they are the acceptance
 * criteria for this surface, not decoration, so they get tests rather than
 * comments.
 */

import { describe, it, expect } from "vitest";
import {
  anchorKey,
  effectiveAgeSecs,
  buildMachineGroups,
  classifyFreshness,
  coupledWslHeadroomBytes,
  floorsForLane,
  formatRatioOfCeiling,
  hostIsBindingConstraint,
  laneShowsSwap,
  pressureFormula,
  pressureLabel,
  pressureTone,
  safeRatio,
  SATURATED_AT,
  summarizeFleetPressure,
  EXPIRED_AFTER_SECS,
  STALE_AFTER_SECS,
} from "./fleetResources";
import type { ResourceSampleRow } from "./fleetResources";

const GIB = 1024 ** 3;

function sample(overrides: Partial<ResourceSampleRow> = {}): ResourceSampleRow {
  return {
    device_id: "dev-1",
    lane: "host",
    lane_instance: null,
    sampled_at: new Date().toISOString(),
    age_secs: 10,
    cpu_cores: 16,
    load_1m: null,
    mem_total_bytes: 32 * GIB,
    mem_available_bytes: 4 * GIB,
    commit_total_bytes: 64 * GIB,
    commit_available_bytes: 13 * GIB,
    swap_total_bytes: null,
    swap_used_bytes: null,
    disk_total_bytes: 1000 * GIB,
    disk_free_bytes: 100 * GIB,
    disk_mount: "D:",
    build_slots_total: 4,
    build_slots_busy: 1,
    build_queue_depth: 0,
    ci_jobs_running: null,
    source: "supervisor",
    pressure: { ratio: 0.8, basis: "commit" },
    ...overrides,
  };
}

describe("the anchor is COALESCE(lane_instance, '')", () => {
  it("collapses a null lane_instance to the empty string, matching the index", () => {
    expect(anchorKey("d", "wsl", null)).toBe("d|wsl|");
    expect(anchorKey("d", "wsl", undefined)).toBe("d|wsl|");
  });

  it("keeps the two co-resident Actions runner services apart", () => {
    expect(anchorKey("d", "wsl", "msi-wsl/qontinui-coord")).not.toBe(
      anchorKey("d", "wsl", "msi-wsl/qontinui-web")
    );
  });
});

describe("§C3 — a machine with no recent sample is unknown, never healthy", () => {
  it("gives a device with no sample a row, and marks it unknown", () => {
    const groups = buildMachineGroups(
      [{ device_id: "dev-1", hostname: "msi" }],
      []
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].freshness).toBe("unknown");
    expect(groups[0].rows[0].sample).toBeNull();
  });

  it("does NOT drop a machine that stopped publishing (vanishing == false-safe)", () => {
    const groups = buildMachineGroups(
      [
        { device_id: "dev-1", hostname: "msi" },
        { device_id: "dev-2", hostname: "spaceship" },
      ],
      [sample({ device_id: "dev-1" })]
    );
    expect(groups.map((g) => g.displayName)).toEqual(["msi", "spaceship"]);
    expect(
      groups.find((g) => g.displayName === "spaceship")!.rows[0].freshness
    ).toBe("unknown");
  });

  it("still renders a publishing device coord's health list does not carry", () => {
    const groups = buildMachineGroups([], [sample({ device_id: "ghost" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].displayName).toBe("ghost");
  });

  it("keys on hostname with device_id as the fallback", () => {
    const groups = buildMachineGroups(
      [{ device_id: "dev-1" }],
      [sample({ device_id: "dev-1" })]
    );
    expect(groups[0].displayName).toBe("dev-1");
  });

  it("a null pressure from the server is unknown — never 0 and never green", () => {
    expect(pressureTone("fresh", null)).toBe("unknown");
    expect(pressureTone("fresh", { ratio: 0, basis: "commit" })).toBe("ok");
    // …and the two are distinguishable, which is the point.
    expect(pressureTone("fresh", null)).not.toBe(
      pressureTone("fresh", { ratio: 0, basis: "commit" })
    );
  });
});

describe("§C3 — a stale sample renders as stale, not as its last value", () => {
  it("classifies by age against the publish cadence", () => {
    expect(classifyFreshness(sample({ age_secs: 10 }))).toBe("fresh");
    expect(classifyFreshness(sample({ age_secs: STALE_AFTER_SECS + 1 }))).toBe(
      "stale"
    );
    expect(
      classifyFreshness(sample({ age_secs: EXPIRED_AFTER_SECS + 1 }))
    ).toBe("unknown");
    expect(classifyFreshness(null)).toBe("unknown");
    expect(classifyFreshness(sample({ age_secs: NaN }))).toBe("unknown");
  });

  it("forces the lead column to unknown when the sample is stale, whatever the last ratio said", () => {
    const green = { ratio: 0.05, basis: "commit" as const };
    expect(pressureTone("fresh", green)).toBe("ok");
    expect(pressureTone("stale", green)).toBe("unknown");
    expect(pressureTone("unknown", green)).toBe("unknown");
  });

  it("tones a fresh saturated lane critical", () => {
    expect(pressureTone("fresh", { ratio: 0.9, basis: "swap" })).toBe(
      "critical"
    );
    expect(pressureTone("fresh", { ratio: 0.7, basis: "swap" })).toBe("warn");
  });
});

describe("§C1 — the row says WHICH metric it is showing", () => {
  it("labels the two instruments differently", () => {
    expect(pressureLabel("swap")).not.toBe(pressureLabel("commit"));
    expect(pressureFormula("swap")).toBe("swap_used / swap_total");
    expect(pressureFormula("commit")).toBe(
      "1 − commit_available / commit_total"
    );
  });

  it("never permits a swap figure on a host row", () => {
    expect(laneShowsSwap("host")).toBe(false);
    expect(laneShowsSwap("wsl")).toBe(true);
    expect(laneShowsSwap("container")).toBe(true);
  });
});

describe("§C3 — the WSL lane's headroom is never shown as spendable on its own", () => {
  const wsl = sample({
    lane: "wsl",
    mem_available_bytes: 9 * GIB,
    commit_available_bytes: null,
    commit_total_bytes: null,
    swap_total_bytes: 8 * GIB,
    swap_used_bytes: 6 * GIB,
    pressure: { ratio: 0.75, basis: "swap" },
  });

  it("clamps to the host's free commit — the literal 2026-08-02 state", () => {
    // WSL says 9 GB free; the host has 900 MB of free commit.
    const host = sample({ commit_available_bytes: 900 * 1024 * 1024 });
    expect(coupledWslHeadroomBytes(wsl, host)).toBe(900 * 1024 * 1024);
    expect(hostIsBindingConstraint(wsl, host)).toBe(true);
  });

  it("reports the WSL figure when the host is NOT the binding constraint", () => {
    const host = sample({ commit_available_bytes: 20 * GIB });
    expect(coupledWslHeadroomBytes(wsl, host)).toBe(9 * GIB);
    expect(hostIsBindingConstraint(wsl, host)).toBe(false);
  });

  it("returns null rather than guessing when the host lane has not reported", () => {
    expect(coupledWslHeadroomBytes(wsl, null)).toBeNull();
    expect(
      coupledWslHeadroomBytes(wsl, sample({ commit_available_bytes: null }))
    ).toBeNull();
    expect(hostIsBindingConstraint(wsl, null)).toBe(false);
  });

  it("exposes the host lane to every lane row of the same machine", () => {
    const groups = buildMachineGroups(
      [{ device_id: "dev-1", hostname: "msi" }],
      [sample({ device_id: "dev-1" }), { ...wsl, device_id: "dev-1" }]
    );
    const wslRow = groups[0].rows.find((r) => r.lane === "wsl")!;
    expect(wslRow.hostSample?.lane).toBe("host");
  });
});

describe("§C1 — everything is a ratio against its own ceiling", () => {
  it("refuses to produce a ratio without a ceiling", () => {
    expect(safeRatio(1, null)).toBeNull();
    expect(safeRatio(null, 1)).toBeNull();
    expect(safeRatio(1, 0)).toBeNull();
    expect(safeRatio(1, 2)).toBe(0.5);
  });

  it("prints the ceiling and the percentage alongside the byte count", () => {
    expect(formatRatioOfCeiling(100 * GIB, 1000 * GIB)).toBe(
      "100 GB / 1000 GB (10%)"
    );
    expect(formatRatioOfCeiling(100 * GIB, null)).toBe("—");
  });
});

describe("§C3 — the effective floors, with defer vs reject kept apart", () => {
  it("shows the ci_node lane rejecting where the supervisor defers", () => {
    const hostFloors = floorsForLane("host");
    const wslFloors = floorsForLane("wsl");
    expect(hostFloors.some((f) => f.verdict === "defers")).toBe(true);
    expect(wslFloors.some((f) => f.verdict === "rejects")).toBe(true);
    // The divergence §A3 exists to converge must be VISIBLE, not smoothed.
    const superviseMem = hostFloors.find((f) =>
      f.guard.includes("build pool")
    )!;
    const ciNodeMem = wslFloors.find((f) =>
      f.guard.includes("ci_node admission")
    )!;
    expect(superviseMem.threshold).not.toBe(ciNodeMem.threshold);
    expect(superviseMem.quantity).not.toBe(ciNodeMem.quantity);
    expect(superviseMem.verdict).not.toBe(ciNodeMem.verdict);
  });

  it("treats `container` as the same executor lane as `wsl`", () => {
    expect(floorsForLane("container")).toEqual(floorsForLane("wsl"));
    expect(floorsForLane(null)).toEqual([]);
  });
});

describe("the hoisted page alarm", () => {
  it("counts a saturated fresh lane, and never folds unknown into healthy", () => {
    const s = summarizeFleetPressure(
      [
        { device_id: "d1", hostname: "msi" },
        { device_id: "d2", hostname: "spaceship" },
      ],
      [
        sample({ device_id: "d1", pressure: { ratio: 0.95, basis: "commit" } }),
        sample({
          device_id: "d1",
          lane: "wsl",
          age_secs: STALE_AFTER_SECS + 5,
          pressure: { ratio: 0.1, basis: "swap" },
        }),
      ]
    );
    expect(s.saturated).toBe(1);
    expect(s.stale).toBe(1);
    // d2 published nothing at all.
    expect(s.unknown).toBe(1);
  });

  it("counts a fresh lane with no server opinion as unknown, not as fine", () => {
    const s = summarizeFleetPressure(
      [{ device_id: "d1" }],
      [sample({ device_id: "d1", pressure: null })]
    );
    expect(s).toEqual({ saturated: 0, stale: 0, unknown: 1 });
  });
});

describe("§C3 — a frozen age_secs must not keep a dead fleet green", () => {
  it("adds wall-clock elapsed since the payload arrived to the server's age", () => {
    expect(effectiveAgeSecs(sample({ age_secs: 15 }), 0)).toBe(15);
    expect(effectiveAgeSecs(sample({ age_secs: 15 }), 600)).toBe(615);
    expect(effectiveAgeSecs(null, 600)).toBeNull();
    // A negative interval (clock stepped backwards) must not make a row younger.
    expect(effectiveAgeSecs(sample({ age_secs: 15 }), -100)).toBe(15);
  });

  it("crosses the stale threshold during an outage, with no new payload", () => {
    // The payload said 15s and will never be refreshed again — this is the
    // literal shape of the 2026-08-02 misdiagnosis.
    const frozen = sample({ age_secs: 15 });
    expect(classifyFreshness(frozen, 0)).toBe("fresh");
    expect(classifyFreshness(frozen, STALE_AFTER_SECS)).toBe("stale");
    expect(classifyFreshness(frozen, EXPIRED_AFTER_SECS)).toBe("unknown");
  });

  it("ages the hoisted page alarm out too, instead of holding an all-clear", () => {
    const devices = [{ device_id: "d1", hostname: "msi" }];
    const latest = [sample({ device_id: "d1", age_secs: 15 })];
    expect(summarizeFleetPressure(devices, latest, 0)).toEqual({
      saturated: 0,
      stale: 0,
      unknown: 0,
    });
    expect(summarizeFleetPressure(devices, latest, 3600)).toEqual({
      saturated: 0,
      stale: 1,
      unknown: 0,
    });
  });
});

describe("the saturation threshold has ONE definition", () => {
  it("pressureTone and summarizeFleetPressure agree at the boundary", () => {
    const at = { ratio: SATURATED_AT, basis: "commit" as const };
    const below = { ratio: SATURATED_AT - 0.001, basis: "commit" as const };
    expect(pressureTone("fresh", at)).toBe("critical");
    expect(pressureTone("fresh", below)).toBe("warn");
    expect(
      summarizeFleetPressure(
        [{ device_id: "d1" }],
        [sample({ device_id: "d1", pressure: at })]
      ).saturated
    ).toBe(1);
    expect(
      summarizeFleetPressure(
        [{ device_id: "d1" }],
        [sample({ device_id: "d1", pressure: below })]
      ).saturated
    ).toBe(0);
  });
});
