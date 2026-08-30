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
  AXIS_DIRECTION,
  pressureAxisIsSwap,
  pressureAxisLabel,
  effectiveAgeSecs,
  buildMachineGroups,
  classifyFreshness,
  classifySaturation,
  formatSaturationCounts,
  hasSaturationValue,
  saturationCounts,
  saturationSourceLabel,
  SATURATION_REPORT_MEANING,
  coupledWslHeadroomBytes,
  describeFloor,
  describePressureFloor,
  formatFloor,
  formatPressureFloor,
  formatRatioOfCeiling,
  formatWarnMargin,
  hasPressureValue,
  headroomReport,
  headroomTone,
  HEADROOM_LABEL,
  HEADROOM_MEANING,
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
import type {
  EffectiveFloor,
  EffectivePressureFloor,
  ResourceSampleRow,
} from "./fleetResources";

const GIB = 1024 ** 3;

const MEM_FLOOR: EffectiveFloor = {
  basis: "commit_available",
  bytes: 5 * GIB,
  source: "default",
  verdict: "defer",
  // The rejecting enforcer on the SAME column, deliberately lower: the
  // supervisor defers at 5 GiB so the runner's ci_node reject at 4 GiB is
  // reached only after the recoverable wait has had its chance.
  reject_bytes: 4 * GIB,
  reject_source: "policy",
};

const DISK_FLOOR: EffectiveFloor = {
  basis: "disk_free",
  bytes: 30 * GIB,
  source: "policy",
  verdict: "reject",
  reject_bytes: 30 * GIB,
  reject_source: "policy",
};

/**
 * The `ci_node` swap-ratio defer — the ONLY guard on the Linux lanes, since
 * nothing in the fleet floors `mem_available_bytes`.
 */
const SWAP_FLOOR: EffectivePressureFloor = {
  basis: "swap_ratio",
  ratio: 0.5,
  source: "default",
  verdict: "defer",
  reject_ratio: null,
  reject_source: null,
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
    // The Windows host lane: byte floors, no pressure ceiling.
    pressure_floor: null,
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
  delete row.pressure_floor;
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
    expect(formatFloor(MEM_FLOOR)).toBe("5.0 GB free commit");
    expect(
      formatFloor({ ...MEM_FLOOR, basis: "mem_available", bytes: 2 * GIB })
    ).toBe("2.0 GB available memory");
    expect(formatFloor(DISK_FLOOR)).toBe("30.0 GB free disk");
  });

  it("keeps defer and reject distinguishable — one fails the work, one delays it", () => {
    const deferred = describeFloor(MEM_FLOOR)!;
    const rejected = describeFloor(DISK_FLOOR)!;
    expect(deferred.verdict).toBe("defer");
    expect(deferred.verdictLabel).toBe("defers");
    expect(rejected.verdict).toBe("reject");
    expect(rejected.verdictLabel).toBe("rejects");
    expect(deferred.verdict).not.toBe(rejected.verdict);
  });

  it("says whether the number came from policy or from the built-in default", () => {
    expect(describeFloor(MEM_FLOOR)!.source).toBe("default");
    expect(describeFloor(DISK_FLOOR)!.source).toBe("policy");
  });

  it("carries BOTH enforcers on a doubly-guarded column, with the rejecting one below", () => {
    // The host commit column is guarded twice on purpose. Showing only the
    // deferring number would tell an operator a refusing machine was merely
    // slow; showing only the rejecting one would say builds fail when they
    // are waiting.
    const d = describeFloor(MEM_FLOOR)!;
    expect(d.value).toBe("5.0 GB free commit");
    expect(d.verdict).toBe("defer");
    expect(d.reject).toEqual({
      kind: "present",
      value: "4.0 GB free commit",
      source: "policy",
      sourceLabel: "policy",
    });
  });

  it("does not print the rejecting enforcer twice when it IS the floor", () => {
    // The disk floor has one enforcer and it rejects. Repeating the same
    // number under a second badge reads as two guards where there is one.
    expect(describeFloor(DISK_FLOOR)!.reject).toEqual({ kind: "same" });
  });

  it("keeps 'no rejecting enforcer' apart from 'nobody told us'", () => {
    // null: coord says nothing refuses work on this column.
    expect(describeFloor({ ...MEM_FLOOR, reject_bytes: null })!.reject).toEqual(
      { kind: "none" }
    );
    // absent: an older coord never mentioned one. NOT the same claim, and
    // only the first is safe to act on.
    const legacy = { ...MEM_FLOOR };
    delete legacy.reject_bytes;
    delete legacy.reject_source;
    expect(describeFloor(legacy)!.reject).toEqual({ kind: "not-reported" });
  });

  it("never falls back to `bytes` or to zero for a missing reject threshold", () => {
    const d = describeFloor({ ...MEM_FLOOR, reject_bytes: null })!;
    expect(JSON.stringify(d.reject)).not.toMatch(/5\.0 GB|0 B/);
  });

  it("reads the amber margin off the response instead of naming 1.5 itself", () => {
    expect(formatWarnMargin(1.5)).toBe("x1.5");
    expect(formatWarnMargin(2)).toBe("x2");
    // Absent, or nonsense: say so rather than printing a plausible default.
    expect(formatWarnMargin(undefined)).toBe("not reported");
    expect(formatWarnMargin(null)).toBe("not reported");
    expect(formatWarnMargin(0)).toBe("not reported");
    expect(formatWarnMargin(NaN)).toBe("not reported");
  });

  it("degrades an unrecognized verdict to unknown, NOT to the softer arm", () => {
    // The previous spelling of this field was "rejects"/"defers" and had a
    // third value. A coord one version off must not have a hard-refusing
    // lane render as one that merely waits.
    const d = describeFloor({
      ...MEM_FLOOR,
      verdict: "rejects" as unknown as EffectiveFloor["verdict"],
    })!;
    expect(d.verdict).toBe("unrecognized");
    expect(d.verdictLabel).toMatch(/unknown/);
    expect(d.verdictLabel).toMatch(/rejects/);
    expect(d.verdictLabel).not.toBe("defers");
  });

  it("degrades an unrecognized source to unknown rather than asserting 'default'", () => {
    const d = describeFloor({
      ...MEM_FLOOR,
      source: "inherited" as unknown as EffectiveFloor["source"],
    })!;
    expect(d.source).toBe("unknown");
    expect(d.sourceLabel).toMatch(/inherited/);
  });

  it("spells out what breach and warn MEAN, not just their colour", () => {
    // §C3: the operator must see whether the lane defers or rejects. The two
    // are different events — one fails the work, the other delays it.
    expect(HEADROOM_MEANING.breach).toMatch(/refus/i);
    expect(HEADROOM_MEANING.warn).toMatch(/wait/i);
    expect(HEADROOM_LABEL.breach).not.toBe(HEADROOM_LABEL.warn);
    expect(HEADROOM_MEANING.unknown).not.toMatch(/health(y)?[^.]*$/i);
  });

  it("returns null — 'not reported' — rather than inventing a floor", () => {
    // Absent from an older coord. A lane with no STATED floor must not read
    // as a lane with no limit.
    expect(describeFloor(undefined)).toBeNull();
    expect(describeFloor(null)).toBeNull();
    expect(describeFloor({ ...MEM_FLOOR, bytes: NaN })).toBeNull();
    // A negative floor is corrupt, not small — it must not print as "-1.0 B".
    expect(describeFloor({ ...MEM_FLOOR, bytes: -1 })).toBeNull();
    expect(formatFloor(null)).toBe("unknown");
  });
});

describe("§C3 — why a row is unknown has three distinct answers", () => {
  it("tells an older coord apart from a coord ahead of this build", () => {
    expect(headroomReport(preFloorSample())).toBe("absent");
    expect(headroomReport(sample({ headroom: null }))).toBe("absent");
    expect(headroomReport(sample({ headroom: "ok" }))).toBe("recognized");
    expect(headroomReport(sample({ headroom: "unknown" }))).toBe("recognized");
    expect(
      headroomReport(
        sample({
          headroom: "quarantined" as unknown as ResourceSampleRow["headroom"],
        })
      )
    ).toBe("unrecognized");
    expect(headroomReport(null)).toBe("absent");
  });
});

describe("§C3 — the pressure axis, where the Linux lanes' only guard lives", () => {
  it("renders the ratio on the same axis the pressure column already uses", () => {
    // Directly comparable by eye with the row's pressure percentage — a
    // threshold the operator cannot compare to the number beside it says
    // nothing.
    expect(formatPressureFloor(SWAP_FLOOR)).toBe("50% swap used");
  });

  it("runs the direction the OTHER way from a byte floor", () => {
    // A byte floor is crossed going down; a pressure ceiling going up. One
    // preposition cannot serve both without inverting the meaning.
    const bytes = describeFloor(MEM_FLOOR)!;
    const ratio = describePressureFloor(SWAP_FLOOR)!;
    expect(bytes.axis).toBe("bytes");
    expect(bytes.direction).toBe("below");
    expect(ratio.axis).toBe("ratio");
    expect(ratio.direction).toBe("at or above");
    expect(ratio.direction).not.toBe(bytes.direction);
    expect(ratio.verdictLabel).toBe("defers");
  });

  it("keeps 'no pressure threshold' apart from 'not reported'", () => {
    // null on the Windows host lane is a fact: its guards are byte-based.
    expect(describePressureFloor(null)).toBeNull();
    expect(describePressureFloor(undefined)).toBeNull();
    // …the distinction itself is carried by the row field, not the describer:
    expect(sample().pressure_floor).toBeNull();
    expect(preFloorSample().pressure_floor).toBeUndefined();
  });

  it("refuses a ratio outside [0, 1] rather than printing 110%", () => {
    expect(describePressureFloor({ ...SWAP_FLOOR, ratio: 1.2 })).toBeNull();
    expect(describePressureFloor({ ...SWAP_FLOOR, ratio: -0.1 })).toBeNull();
    expect(describePressureFloor({ ...SWAP_FLOOR, ratio: NaN })).toBeNull();
    expect(formatPressureFloor({ ...SWAP_FLOOR, ratio: 2 })).toBe("unknown");
  });

  it("carries a rejecting enforcer on the ratio axis too", () => {
    const d = describePressureFloor({
      ...SWAP_FLOOR,
      reject_ratio: 0.9,
      reject_source: "policy",
    })!;
    expect(d.reject).toEqual({
      kind: "present",
      value: "90% swap used",
      source: "policy",
      sourceLabel: "policy",
    });
  });

  it("degrades an unrecognized ratio verdict to unknown, not to the softer arm", () => {
    const d = describePressureFloor({
      ...SWAP_FLOOR,
      verdict: "defers" as unknown as EffectivePressureFloor["verdict"],
    })!;
    expect(d.verdict).toBe("unrecognized");
    expect(d.verdictLabel).toMatch(/defers\)/);
    expect(d.enforced).toBe(false);
  });
});

describe("§C3 — a threshold nothing enforces must not inherit a verb", () => {
  it("renders a null verdict as 'set, not enforced'", () => {
    // `min_free_mem_bytes_wsl` ships, validates and versions with NO
    // consumer. A tenant can set it, coord reports it, nothing acts on it.
    // Showing it as though it acts is this task's own defect in miniature.
    const d = describeFloor({ ...MEM_FLOOR, verdict: null })!;
    expect(d.verdict).toBe("unset");
    expect(d.verdictLabel).toBe("set, not enforced");
    // No verb, and the primary line will withhold its direction word —
    // there is no behaviour to describe.
    expect(d.verdictLabel).not.toMatch(/defers|rejects/);
    expect(d.enforced).toBe(false);
    // The number itself is still shown: it IS configured, just inert.
    expect(d.value).toBe("5.0 GB free commit");
  });

  it("does the same on the pressure axis", () => {
    const d = describePressureFloor({ ...SWAP_FLOOR, verdict: null })!;
    expect(d.verdict).toBe("unset");
    expect(d.enforced).toBe(false);
    // The AXIS still runs the way it runs — the preposition belongs to the
    // axis, so a rejecting enforcer under this primary still gets one.
    expect(d.direction).toBe("at or above");
  });

  it("still gives a rejecting enforcer its preposition under an unenforced primary", () => {
    // Deriving the direction word from the primary verdict dropped it here,
    // leaving "rejects 90% swap used" with no indication of which side of 90%
    // is the bad one.
    const d = describePressureFloor({
      ...SWAP_FLOOR,
      verdict: null,
      reject_ratio: 0.9,
      reject_source: "policy",
    })!;
    expect(d.enforced).toBe(false);
    expect(d.direction).toBe("at or above");
    expect(d.reject).toMatchObject({ kind: "present", value: "90% swap used" });
  });

  it("never lets an UNREADABLE reject threshold read as 'there is none'", () => {
    // "no reject threshold" is an affirmative claim that nothing refuses work
    // here. A NaN or an out-of-range number must not produce it — unreadable
    // becoming safe is the false-safe this surface exists to remove.
    for (const bad of [NaN, -1, Infinity]) {
      expect(
        describeFloor({ ...MEM_FLOOR, reject_bytes: bad })!.reject
      ).toEqual({ kind: "unreadable" });
    }
    for (const bad of [NaN, 1.4, -0.2]) {
      expect(
        describePressureFloor({ ...SWAP_FLOOR, reject_ratio: bad })!.reject
      ).toEqual({ kind: "unreadable" });
    }
    // …and ONLY an explicit null is "there is none".
    expect(describeFloor({ ...MEM_FLOOR, reject_bytes: null })!.reject).toEqual(
      { kind: "none" }
    );
    expect(
      describePressureFloor({ ...SWAP_FLOOR, reject_ratio: null })!.reject
    ).toEqual({ kind: "none" });
  });

  it("withholds the 'set past it on purpose' claim when the order is reversed", () => {
    // Past means LOWER on a byte floor and HIGHER on a ceiling. When coord
    // sends them the other way round, the copy must not assert the usual
    // story over the data.
    expect(describeFloor(MEM_FLOOR)!.rejectIsPastPrimary).toBe(true);
    expect(
      describeFloor({ ...MEM_FLOOR, reject_bytes: 9 * GIB })!
        .rejectIsPastPrimary
    ).toBe(false);
    expect(
      describePressureFloor({ ...SWAP_FLOOR, reject_ratio: 0.9 })!
        .rejectIsPastPrimary
    ).toBe(true);
    expect(
      describePressureFloor({ ...SWAP_FLOOR, reject_ratio: 0.3 })!
        .rejectIsPastPrimary
    ).toBe(false);
  });

  it("escalates precision rather than printing one number twice", () => {
    // 0.5 and 0.504 both round to 50%: two distinct thresholds that would
    // otherwise render identically under two different badges.
    const d = describePressureFloor({
      ...SWAP_FLOOR,
      ratio: 0.5,
      reject_ratio: 0.504,
      reject_source: "policy",
    })!;
    const rejectValue = (d.reject as { kind: "present"; value: string }).value;
    expect(d.value).not.toBe(rejectValue);
    expect(d.value).toMatch(/50\.0%/);
    expect(rejectValue).toMatch(/50\.4%/);
    // …and the common case keeps whole percents.
    expect(describePressureFloor(SWAP_FLOOR)!.value).toBe("50% swap used");
  });

  it("derives the axis label and the swap-suppression gate from the basis", () => {
    expect(pressureAxisLabel("swap_ratio")).toBe("swap");
    expect(pressureAxisIsSwap("swap_ratio")).toBe(true);
    // The saturation ceiling gets its own word, and is NOT gated by the
    // swap-suppression rule — coord reports it on every lane including the
    // Windows host, which is the lane the 2026-08-27 incident was on.
    expect(pressureAxisLabel("thread_ratio")).toBe("saturation");
    expect(pressureAxisIsSwap("thread_ratio")).toBe(false);
    // A future basis must not be labelled "swap" NOR gated by the swap rule.
    expect(pressureAxisLabel("psi_some_avg10")).toBe("psi_some_avg10");
    expect(pressureAxisIsSwap("psi_some_avg10")).toBe(false);
  });

  it("keeps the direction word in ONE place, keyed by the axis", () => {
    // The claim "FloorDetail carries the axis and the preposition so the
    // wording cannot drift" is only true while both describers read the same
    // map. A literal in each function is exactly the drift it claims to stop.
    expect(describeFloor(MEM_FLOOR)!.direction).toBe(AXIS_DIRECTION.bytes);
    expect(describePressureFloor(SWAP_FLOOR)!.direction).toBe(
      AXIS_DIRECTION.ratio
    );
    expect(AXIS_DIRECTION.bytes).not.toBe(AXIS_DIRECTION.ratio);
  });

  it("keeps 'unset' distinct from 'unknown' — different causes, different fixes", () => {
    const unset = describeFloor({ ...MEM_FLOOR, verdict: null })!;
    const unknown = describeFloor({
      ...MEM_FLOOR,
      verdict: "defers" as unknown as EffectiveFloor["verdict"],
    })!;
    const legacy = { ...MEM_FLOOR };
    delete (legacy as { verdict?: unknown }).verdict;
    const unreported = describeFloor(legacy as EffectiveFloor)!;
    // Four states, four labels: nothing acts on it / this build cannot read
    // it / coord never said. Collapsing any pair is the same two-claims-in-one
    // defect this task removes a level up.
    expect(unset.verdict).not.toBe(unknown.verdict);
    expect(unset.verdictLabel).not.toBe(unknown.verdictLabel);
    expect(unreported.verdict).toBe("unreported");
    expect(unreported.verdictLabel).toMatch(/not reported/);
    expect(unreported.verdictLabel).not.toBe(unknown.verdictLabel);
    expect(unreported.enforced).toBe(false);
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

  it("ages an EXPIRED green verdict into unknown, not into the stale bucket", () => {
    // Past EXPIRED_AFTER_SECS the row carries no information at all — a
    // last-known "ok" from six hours ago is not a stale reading of a live
    // machine, it is silence.
    const s = summarizeFleetAdmission(
      [{ device_id: "d1" }],
      [
        sample({
          device_id: "d1",
          age_secs: EXPIRED_AFTER_SECS + 60,
          headroom: "ok",
        }),
      ]
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

/**
 * The SATURATION axis — plan
 * `2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory`, Phase 5.
 *
 * These pin the presentation rules, not the arithmetic: the ratio and the
 * threshold are both coord's, and this module's only jobs are (a) never to
 * render an unmeasured axis as green, and (b) to say WHICH absence it is
 * looking at, because the operator's next move differs by cause.
 */
describe("the saturation axis renders unknown, never green", () => {
  /** The literal 2026-08-27 host-lane row, as coord serializes it. */
  const INCIDENT = {
    saturation: { ratio: 190840 / 192146, basis: "threads" as const },
    threads_used: 190840,
    threads_max: 192146,
    pids_used: null,
    pids_max: null,
    saturation_source: "cgroup",
  };

  it("classifies a measured row, and captions it with the counts it came from", () => {
    expect(classifySaturation(INCIDENT)).toBe("measured");
    expect(hasSaturationValue(INCIDENT.saturation)).toBe(true);
    expect(formatSaturationCounts(INCIDENT)).toBe("190,840 / 192,146 threads");
    expect(saturationCounts(INCIDENT)).toEqual({
      used: 190840,
      max: 192146,
      kind: "threads",
    });
  });

  it("separates a publisher that predates the probe from one whose probe FAILED", () => {
    // All-NULL: the activation window. Every runner in the fleet reads this
    // way until it is next rebuilt, and coord skips GRADING the axis rather
    // than pinning every row in the fleet to unknown.
    const unmeasured = {
      saturation: null,
      threads_used: null,
      threads_max: null,
      pids_used: null,
      pids_max: null,
      saturation_source: null,
    };
    expect(classifySaturation(unmeasured)).toBe("unmeasured");

    // A ceiling with no count is a REAL gap — a probe that ran and failed —
    // and must not be filed under the same word as a publisher that has no
    // probe at all. Coord grades this one unknown; it does not skip it.
    expect(classifySaturation({ ...unmeasured, threads_max: 192146 })).toBe(
      "gap"
    );
    // …and so is the reverse, a count with no ceiling to divide it by.
    expect(classifySaturation({ ...unmeasured, threads_used: 190840 })).toBe(
      "gap"
    );

    // No keys at all: a coord that predates the axis. Absent and null are
    // different claims and this module keeps them apart everywhere else too.
    expect(classifySaturation({})).toBe("unreported");
    expect(classifySaturation(undefined)).toBe("unreported");
  });

  it("never lets an unmeasured axis read as fine, in any of its wordings", () => {
    for (const report of ["gap", "unmeasured", "unreported"] as const) {
      const text = SATURATION_REPORT_MEANING[report];
      expect(text).toBeTruthy();
      // Not one of the three may end on a reassurance. `unmeasured` is the
      // dangerous one: it is the whole fleet's state for the entire
      // activation window, and it is the reading a hurried author is most
      // tempted to default to ok.
      expect(text).not.toMatch(/\bhealthy\b(?![^.]*not)/i);
    }
    expect(SATURATION_REPORT_MEANING.unmeasured).toMatch(/NOT healthy/);
    expect(SATURATION_REPORT_MEANING.unmeasured).toMatch(/NOT zero/);
    // The four wordings are genuinely four, not one repeated.
    expect(new Set(Object.values(SATURATION_REPORT_MEANING)).size).toBe(4);
  });

  it("prefers the threads pair over pids, the same way coord does", () => {
    // coord's `lane_saturation` is `threads.or_else(pids)`. Captioning a
    // threads-derived ratio with the pids counts would print numbers the
    // ratio did not come from — and coord is explicit that tasks and
    // thread-group leaders are different quantities.
    const both = {
      saturation: { ratio: 0.5, basis: "threads" as const },
      threads_used: 100,
      threads_max: 200,
      pids_used: 3,
      pids_max: 4096,
    };
    expect(saturationCounts(both)?.kind).toBe("threads");
    // Only when the threads pair is unusable does the pids pair caption it.
    expect(saturationCounts({ ...both, threads_max: null })?.kind).toBe("pids");
    // A non-positive ceiling is not a ceiling: it would divide by zero into a
    // fabricated 0%, which would rank an unmeasured machine FIRST.
    expect(saturationCounts({ ...both, threads_max: 0 })?.kind).toBe("pids");
    expect(formatSaturationCounts({})).toBe("—");
  });

  it("says which instrument produced the counts, and admits when it was not told", () => {
    // Not bookkeeping: a cgroup reading counts TASKS and a /proc reading
    // counts thread-group leaders, so a publisher whose cgroup probe fails
    // and falls back emits a number that changes meaning with nothing else in
    // the row saying so.
    expect(saturationSourceLabel("cgroup")).toMatch(/task|thread/i);
    expect(saturationSourceLabel("proc")).toMatch(/leader/i);
    expect(saturationSourceLabel("job_object")).toMatch(/job object/i);
    expect(saturationSourceLabel(null)).toMatch(/not reported/i);
    // A value this build cannot read is surfaced WITH the raw string, never
    // silently folded into one of the known three.
    expect(saturationSourceLabel("psi")).toMatch(/psi/);
    expect(saturationSourceLabel("psi")).toMatch(/unknown/i);
  });
});
