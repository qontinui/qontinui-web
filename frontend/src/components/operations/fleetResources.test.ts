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
  describeFloor,
  formatFloor,
  formatRatioOfCeiling,
  hasPressureValue,
  headroomTone,
  hostIsBindingConstraint,
  laneShowsSwap,
  pressureFormula,
  pressureLabel,
  rowHeadroom,
  safeRatio,
  summarizeFleetAdmission,
  EXPIRED_AFTER_SECS,
  STALE_AFTER_SECS,
} from "./fleetResources";
import type { EffectiveFloor, ResourceSampleRow } from "./fleetResources";

const GIB = 1024 ** 3;

const MEM_FLOOR: EffectiveFloor = {
  basis: "commit_available",
  bytes: 4 * GIB,
  source: "default",
  verdict: "defer",
};

const DISK_FLOOR: EffectiveFloor = {
  basis: "disk_free",
  bytes: 30 * GIB,
  source: "policy",
  verdict: "reject",
};

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
    floor: MEM_FLOOR,
    disk_floor: DISK_FLOOR,
    headroom: "ok",
    ...overrides,
  };
}

/**
 * A row from a coord that predates the floor-bands PR: the three new fields
 * are simply absent from the JSON. This is the state the whole fleet is in
 * until the sibling coord PR deploys, so it gets a first-class fixture rather
 * than an afterthought.
 */
function preFloorSample(
  overrides: Partial<ResourceSampleRow> = {}
): ResourceSampleRow {
  const row = sample(overrides);
  delete row.floor;
  delete row.disk_floor;
  delete row.headroom;
  return row;
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

  it("a null pressure from the server has no magnitude — never 0", () => {
    expect(hasPressureValue("fresh", null)).toBe(false);
    expect(hasPressureValue("fresh", { ratio: 0, basis: "commit" })).toBe(true);
    // …and the two are distinguishable, which is the point: a 0 would sort an
    // unmeasured machine first.
    expect(hasPressureValue("fresh", { ratio: NaN, basis: "commit" })).toBe(
      false
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

  it("forces the row tone to unknown when the sample is stale, whatever the last verdict said", () => {
    // coord computed "ok" against numbers that have since stopped being true.
    expect(headroomTone("fresh", "ok")).toBe("ok");
    expect(headroomTone("stale", "ok")).toBe("unknown");
    expect(headroomTone("unknown", "ok")).toBe("unknown");
    // …and the same for a red verdict: a stale breach is not a live breach.
    expect(headroomTone("stale", "breach")).toBe("unknown");
  });
});

describe("§C3 — the row's colour is the SERVER's verdict, not a client band", () => {
  it("maps each admission state to its own tone", () => {
    expect(headroomTone("fresh", "breach")).toBe("critical");
    expect(headroomTone("fresh", "warn")).toBe("warn");
    expect(headroomTone("fresh", "ok")).toBe("ok");
    expect(headroomTone("fresh", "unknown")).toBe("unknown");
  });

  it("never colours from the pressure ratio — 99% pressure with headroom ok stays ok", () => {
    // The exact disagreement the deleted SATURATED_AT/WARN_AT constants
    // produced, in the direction that matters: a very loaded machine that
    // coord is still electing must NOT read red, or the operator drains a
    // box the dispatcher is happily using.
    const loaded = sample({
      pressure: { ratio: 0.99, basis: "commit" },
      headroom: "ok",
    });
    expect(headroomTone("fresh", rowHeadroom(loaded))).toBe("ok");

    // …and the reverse: a lightly-loaded lane whose FLOOR is breached (the
    // floor is on a different column from the ratio) reads red.
    const quietButBreaching = sample({
      pressure: { ratio: 0.02, basis: "swap" },
      headroom: "breach",
    });
    expect(headroomTone("fresh", rowHeadroom(quietButBreaching))).toBe(
      "critical"
    );
  });

  it("treats an absent headroom field as unknown, not as ok", () => {
    // The pre-deployment state: coord has not shipped the field yet.
    expect(rowHeadroom(preFloorSample())).toBe("unknown");
    expect(rowHeadroom(sample({ headroom: null }))).toBe("unknown");
    expect(rowHeadroom(null)).toBe("unknown");
    expect(headroomTone("fresh", rowHeadroom(preFloorSample()))).toBe(
      "unknown"
    );
  });

  it("treats a value this build does not recognize as unknown, not as ok", () => {
    // coord AHEAD of this build. Same rule in the other direction: an
    // unrecognized verdict is not permission to render green.
    const future = sample({
      headroom: "quarantined" as unknown as ResourceSampleRow["headroom"],
    });
    expect(rowHeadroom(future)).toBe("unknown");
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

describe("§C3 — the effective floor, its provenance, and defer vs reject", () => {
  it("renders the floor's value against the column it is measured on", () => {
    // Not a bare byte count and not a percentage: the floor is a byte count
    // ON A NAMED COLUMN, and the column is the reason it cannot be restated
    // as a pressure threshold.
    expect(formatFloor(MEM_FLOOR)).toBe("4.0 GB free commit");
    expect(
      formatFloor({ ...MEM_FLOOR, basis: "mem_available", bytes: 2 * GIB })
    ).toBe("2.0 GB available memory");
    expect(formatFloor(DISK_FLOOR)).toBe("30.0 GB free disk");
  });

  it("keeps defer and reject distinguishable — one fails the work, one delays it", () => {
    const deferred = describeFloor(MEM_FLOOR)!;
    const rejected = describeFloor(DISK_FLOOR)!;
    expect(deferred.verdict).toBe("defers");
    expect(rejected.verdict).toBe("rejects");
    expect(deferred.verdict).not.toBe(rejected.verdict);
  });

  it("says whether the number came from policy or from the built-in default", () => {
    expect(describeFloor(MEM_FLOOR)!.source).toBe("default");
    expect(describeFloor(DISK_FLOOR)!.source).toBe("policy");
  });

  it("returns null — 'not reported' — rather than inventing a floor", () => {
    // Absent from an older coord. A lane with no STATED floor must not read
    // as a lane with no limit.
    expect(describeFloor(undefined)).toBeNull();
    expect(describeFloor(null)).toBeNull();
    expect(describeFloor({ ...MEM_FLOOR, bytes: NaN })).toBeNull();
    expect(formatFloor(null)).toBe("unknown");
  });
});

describe("the hoisted page alarm", () => {
  it("counts a breaching fresh lane, and never folds unknown into healthy", () => {
    const s = summarizeFleetAdmission(
      [
        { device_id: "d1", hostname: "msi" },
        { device_id: "d2", hostname: "spaceship" },
      ],
      [
        sample({ device_id: "d1", headroom: "breach" }),
        sample({
          device_id: "d1",
          lane: "wsl",
          age_secs: STALE_AFTER_SECS + 5,
          headroom: "ok",
        }),
      ]
    );
    expect(s.breach).toBe(1);
    expect(s.stale).toBe(1);
    // d2 published nothing at all.
    expect(s.unknown).toBe(1);
  });

  it("counts the intermediate state separately from the red one", () => {
    const s = summarizeFleetAdmission(
      [{ device_id: "d1" }],
      [
        sample({ device_id: "d1", headroom: "warn" }),
        sample({ device_id: "d1", lane: "wsl", headroom: "breach" }),
      ]
    );
    expect(s).toEqual({ breach: 1, warn: 1, stale: 0, unknown: 0 });
  });

  it("counts a fresh lane coord reports no admission state for as unknown, not as fine", () => {
    const s = summarizeFleetAdmission(
      [{ device_id: "d1" }],
      [preFloorSample({ device_id: "d1" })]
    );
    expect(s).toEqual({ breach: 0, warn: 0, stale: 0, unknown: 1 });
  });

  it("does NOT raise the alarm from a high pressure ratio on its own", () => {
    // Pressure is a magnitude. The header counts what coord will refuse.
    const s = summarizeFleetAdmission(
      [{ device_id: "d1" }],
      [
        sample({
          device_id: "d1",
          pressure: { ratio: 0.99, basis: "commit" },
          headroom: "ok",
        }),
      ]
    );
    expect(s).toEqual({ breach: 0, warn: 0, stale: 0, unknown: 0 });
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
    expect(summarizeFleetAdmission(devices, latest, 0)).toEqual({
      breach: 0,
      warn: 0,
      stale: 0,
      unknown: 0,
    });
    expect(summarizeFleetAdmission(devices, latest, 3600)).toEqual({
      breach: 0,
      warn: 0,
      stale: 1,
      unknown: 0,
    });
  });
});

describe("the red/amber boundary has ONE definition, and it is the server's", () => {
  it("the row tone and the hoisted alarm read the SAME field", () => {
    // Not "agree at a boundary" — there is no boundary here to agree at. Both
    // consumers read coord's verdict verbatim, so they cannot disagree the way
    // the deleted SATURATED_AT/WARN_AT constants could disagree with the
    // dispatcher's floors.
    for (const h of ["ok", "warn", "breach", "unknown"] as const) {
      const row = sample({ device_id: "d1", headroom: h });
      const s = summarizeFleetAdmission([{ device_id: "d1" }], [row]);
      const tone = headroomTone("fresh", rowHeadroom(row));
      expect(s.breach > 0).toBe(tone === "critical");
      expect(s.warn > 0).toBe(tone === "warn");
      expect(s.unknown > 0).toBe(tone === "unknown");
    }
  });

  it("exports no threshold constant of its own", async () => {
    // The defect this change fixes, pinned as a test: a reintroduced
    // client-side band is a reintroduced way for the strip and the ranker to
    // disagree. If a band is needed, it is a server field that is missing.
    const mod = await import("./fleetResources");
    const names = Object.keys(mod);
    expect(names).not.toContain("SATURATED_AT");
    expect(names).not.toContain("WARN_AT");
    expect(names).not.toContain("LANE_FLOORS");
    // The freshness thresholds are NOT in this class: they are about whether
    // a measurement is current, which is a client-side question about the
    // transport, not a verdict coord owns.
    expect(names).toContain("STALE_AFTER_SECS");
  });
});
