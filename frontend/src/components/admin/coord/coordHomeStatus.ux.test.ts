/**
 * coordHomeStatus — the derivations the 2026-10-31 UX pass on
 * `/admin/coord/home` added or changed (plan
 * `2026-10-23-console-presentation-spaces` Phase 2 follow-up). The page-level
 * half is `app/(app)/admin/coord/home/page.ux.test.tsx`.
 */

import { summarizeMachineHealth } from "@/components/admin/coord/machineHealth";
import { describe, expect, it } from "vitest";
import {
  deriveHomeStrip,
  groupBreakdown,
  groupBreakdownSentence,
  noRecordedChangeBadgeLabel,
  sourceRowReason,
  unnamedUnitsSentence,
  unstatedSummary,
  type SourceCoverageView,
  parseProjectState,
  unitCountText,
} from "./coordHomeStatus";

describe("unitCountText", () => {
  it("names one unit in the singular", () => {
    expect(unitCountText(1)).toBe("1 unit");
    expect(unitCountText(1, "work unit")).toBe("1 work unit");
  });

  it("names every other count in the plural", () => {
    expect(unitCountText(0)).toBe("0 units");
    expect(unitCountText(2)).toBe("2 units");
    expect(unitCountText(11, "work unit")).toBe("11 work units");
  });

  it("writes a count coord did not serve as a dash, never a zero", () => {
    expect(unitCountText(null)).toBe("– units");
    expect(unitCountText(null, "work unit")).toBe("– work units");
  });
});

describe("the strip's no-recorded-change badge", () => {
  it("says what it counts and the window in whole words", () => {
    expect(noRecordedChangeBadgeLabel(3, 14 * 86_400)).toBe(
      "3 units with no recorded change in 14 days"
    );
    expect(noRecordedChangeBadgeLabel(1, 7 * 86_400)).toBe(
      "1 unit with no recorded change in 7 days"
    );
  });

  it("is a dash, never a zero, when coord served no count", () => {
    expect(noRecordedChangeBadgeLabel(null, null)).toBe(
      "– units with no recorded change in 14 days"
    );
  });

  it("is the label the strip renders, before and after a read", () => {
    const label = (s: ReturnType<typeof deriveHomeStrip>) =>
      s.badges.find((b) => b.key === "no-change")?.label;
    expect(label(deriveHomeStrip(null))).toBe(
      "– units with no recorded change in 14 days"
    );
    const view = parseProjectState({
      on_track: {
        state: "read",
        totals: { row_count: 2, classes: { stalled: 2 } },
        groups: [],
        stall_window_secs: 21 * 86_400,
      },
    });
    expect(label(deriveHomeStrip(view))).toBe(
      "2 units with no recorded change in 21 days"
    );
    for (const s of [deriveHomeStrip(null), deriveHomeStrip(view)]) {
      expect(s.badges.map((b) => b.label).join(" ")).not.toMatch(/\b\d+ d\b/);
    }
  });
});

describe("a repository group's account of its units", () => {
  const group = (classes: Record<string, unknown>) =>
    parseProjectState({
      on_track: {
        state: "read",
        totals: { row_count: 0, classes: {} },
        groups: [{ key: "r", kind: "repo", row_count: 0, classes }],
      },
    })!.onTrack.groups![0]!;
  const ALL_ZERO = {
    shipped: 0,
    in_flight: 0,
    stalled: 0,
    blocked_on_dependency: 0,
    waiting_on_gate: 0,
    not_started: 0,
    closed_other: 0,
    off_vocabulary: 0,
    unset: 0,
  };

  it("names every class that holds a unit, with its count", () => {
    const b = groupBreakdown(
      group({ ...ALL_ZERO, not_started: 1, shipped: 2, stalled: 1 })
    );
    expect(b.counted).toEqual([
      { cls: "shipped", count: 2 },
      { cls: "stalled", count: 1 },
      { cls: "not_started", count: 1 },
    ]);
    expect(groupBreakdownSentence(b, 14 * 86_400)).toBe(
      "By state: shipped 2 · no recorded change in 14 days 1 · not started 1."
    );
  });

  it("counts the units in classes coord does not name here, and only those", () => {
    expect(
      groupBreakdown(group({ ...ALL_ZERO, not_started: 1, stalled: 3 })).unnamed
    ).toBe(1);
    expect(
      groupBreakdown(group({ ...ALL_ZERO, waiting_on_gate: 2, stalled: 3 }))
        .unnamed
    ).toBe(0);
  });

  it("says a class coord served no count for is unknown, and the unnamed total with it", () => {
    const b = groupBreakdown(group({ ...ALL_ZERO, in_flight: null }));
    expect(b.unserved).toEqual(["in_flight"]);
    expect(b.unnamed).toBeNull();
    expect(groupBreakdownSentence(b, null)).toContain(
      "Coord served no count for in flight — unknown, not zero."
    );
    expect(unnamedUnitsSentence(null)).toMatch(/is unknown\.$/);
  });

  it("an unserved NAMED class leaves the unnamed total known", () => {
    expect(
      groupBreakdown(group({ ...ALL_ZERO, stalled: null, not_started: 2 }))
        .unnamed
    ).toBe(2);
  });

  it("says nothing about unnamed units when there are none", () => {
    expect(unnamedUnitsSentence(0)).toBeNull();
    expect(unnamedUnitsSentence(1)).toContain("the 1 other unit is not listed");
    expect(unnamedUnitsSentence(4)).toContain(
      "the 4 other units are not listed"
    );
  });
});

describe("a clause coord did not state, said once per list", () => {
  const src = (over: Partial<SourceCoverageView>): SourceCoverageView => ({
    source: "work_units",
    state: "read",
    asOf: null,
    freshnessBoundSecs: null,
    rowsConsidered: null,
    rowsExcluded: null,
    exclusionReason: null,
    error: null,
    ...over,
  });

  it("leaves an unstated bound and exclusion count off the row", () => {
    expect(sourceRowReason(src({}), { omitUnstated: true })).toBe("");
    expect(
      sourceRowReason(src({ freshnessBoundSecs: 20, rowsExcluded: 3 }), {
        omitUnstated: true,
      })
    ).toBe("may be up to 20s old · 3 excluded");
    expect(
      sourceRowReason(src({ state: "could_not_read", error: "x" }), {
        omitUnstated: true,
      })
    ).toBe("coord reported an error");
  });

  it("still says 'not stated' on the row when not asked to omit it", () => {
    expect(sourceRowReason(src({}))).toBe(
      "maximum age not stated · exclusions not stated"
    );
  });

  it("counts the rows each unstated field applies to", () => {
    expect(
      unstatedSummary([
        src({}),
        src({ freshnessBoundSecs: 20 }),
        src({ rowsExcluded: 0 }),
      ])
    ).toBe(
      "Coord stated no age bound for 2 of 3, and no count of excluded rows for 2 of 3."
    );
    expect(unstatedSummary([src({}), src({})])).toBe(
      "Coord stated no age bound for all 2, and no count of excluded rows for all 2."
    );
    expect(unstatedSummary([src({ rowsExcluded: 1 })])).toBe(
      "Coord stated no age bound for it."
    );
  });

  it("says nothing when coord stated both for every row, and a zero is stated", () => {
    expect(
      unstatedSummary([src({ freshnessBoundSecs: 0, rowsExcluded: 0 })])
    ).toBeNull();
    expect(unstatedSummary([])).toBeNull();
  });
});

describe("the strip over the machine roster", () => {
  const calm = () =>
    parseProjectState({
      generated_at: "2026-10-31T00:00:00Z",
      on_track: {
        state: "read",
        totals: { row_count: 0, classes: {} },
        groups: [],
      },
      correctness: { state: "read" },
      needs_me: { state: "read", items: [], total: 0, omitted: 0 },
      degradations: { state: "read", headline: "none", open: [], declared: [] },
      does_not_know: [{ source: "work_units", state: "read" }],
    });
  /** A roster of machines in the given states (null: no state at all). */
  const devices = (...states: Array<string | null>) =>
    states.map((state, i) => ({
      device_id: `d-${i}`,
      ...(state === null ? {} : { state }),
    }));
  const machines = (states: Array<string | null>, stale = false) => ({
    machines: { stale, counts: summarizeMachineHealth(devices(...states)) },
  });
  const degradingRow = (deviceId: string) => ({
    id: `fleet_health:state:${deviceId}`,
    plane: "runner",
    subject: { kind: "device", name: "example-host", id: deviceId },
    headline: "A machine has stopped heartbeating to coord",
  });
  const withRows = (...rows: unknown[]) =>
    parseProjectState({
      generated_at: "2026-10-31T00:00:00Z",
      on_track: {
        state: "read",
        totals: { row_count: 0, classes: {} },
        groups: [],
      },
      correctness: { state: "read" },
      needs_me: { state: "read", items: [], total: 0, omitted: 0 },
      degradations: {
        state: "read",
        headline: rows.length > 0 ? "degrading" : "none",
        open: rows,
        declared: [],
      },
      does_not_know: [{ source: "work_units", state: "read" }],
    });

  it("is green only with the roster read and every machine healthy", () => {
    expect(deriveHomeStrip(calm(), machines(["healthy"])).level).toBe("green");
  });

  it("is never green, and never says nothing is degrading, with the roster unread", () => {
    for (const s of [
      deriveHomeStrip(calm()),
      deriveHomeStrip(calm(), { machines: null }),
    ]) {
      expect(s.level).toBe("amber");
      expect(s.headline).not.toMatch(/nothing is degrading/i);
      expect(s.detail).toContain("Machine health was not read.");
      expect(s.badges.find((b) => b.key === "machines")?.label).toBe(
        "machines not healthy –"
      );
    }
  });

  it.each(["degraded", "partitioned", "stale", "ci_offline"])(
    "says something is degrading for a %s machine coord's list does not show",
    (state) => {
      const s = deriveHomeStrip(calm(), machines([state, "healthy"]));
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("Something is degrading");
      expect(s.detail).toContain("1 machine is in a degrading state.");
      expect(s.badges.find((b) => b.key === "machines")?.label).toBe(
        "machines not healthy 1"
      );
    }
  );

  it("never counts a machine coord already lists as a degradation twice", () => {
    const s = deriveHomeStrip(
      withRows(degradingRow("d-0")),
      machines(["partitioned", "healthy"])
    );
    expect(s.headline).toBe("Something is degrading");
    expect(s.badges.find((b) => b.key === "degraded")?.label).toBe(
      "degraded 1"
    );
    expect(s.detail ?? "").not.toMatch(/in a degrading state/);
    // A second degrading machine the list does not show is added, once.
    const two = deriveHomeStrip(
      withRows(degradingRow("d-0")),
      machines(["partitioned", "degraded"])
    );
    expect(two.detail).toContain("1 machine is in a degrading state.");
  });

  it("does not say an abandoned machine is degrading, and reconciles it with the nav", () => {
    const s = deriveHomeStrip(calm(), machines(["abandoned", "healthy"]));
    expect(s.headline).toBe("Nothing needs you and nothing is degrading");
    expect(s.level).toBe("green");
    expect(s.detail).toContain(
      "1 machine not reporting healthy is not a degradation: 1 abandoned — see Dev Ops."
    );
    // The badge is the nav's count, so the two read the same number.
    expect(s.badges.find((b) => b.key === "machines")?.label).toBe(
      "machines not healthy 1"
    );
  });

  it("reads coord's explicit unknown, a placeholder, and no state as no verdict — UNKNOWN, never degrading nor calm", () => {
    for (const roster of [
      machines(["unknown"]),
      machines([null]),
      {
        machines: {
          stale: false,
          counts: summarizeMachineHealth([
            {
              device_id: "p",
              state: "partitioned",
              dispatch_liveness: "unknown",
            },
          ]),
        },
      },
    ]) {
      const s = deriveHomeStrip(calm(), roster);
      expect(s.level).toBe("amber");
      expect(s.headline).not.toBe("Something is degrading");
      expect(s.headline).not.toMatch(/nothing is degrading/i);
      expect(s.detail).toContain("1 machine has no health verdict — unknown.");
    }
  });

  it("says, by state, what the nav counts that home does not call degrading", () => {
    const s = deriveHomeStrip(calm(), machines(["abandoned", "unknown", null]));
    expect(s.detail).toContain(
      "2 machines not reporting healthy are not degradations: 1 abandoned, 1 with no verdict — see Dev Ops."
    );
    expect(s.badges.find((b) => b.key === "machines")?.label).toBe(
      "machines not healthy 2"
    );
  });

  it("never answers 'nothing is degrading' over an empty roster, and names a binding fault UNKNOWN", () => {
    const none = deriveHomeStrip(calm(), {
      machines: {
        stale: false,
        counts: summarizeMachineHealth([]),
        emptyRoster: { kind: "none_withheld" },
      },
    });
    expect(none.level).toBe("amber");
    expect(none.headline).not.toMatch(/nothing is degrading/i);
    expect(none.detail).toContain(
      "Coord lists no machines and withheld none from its roster"
    );
    const fault = deriveHomeStrip(calm(), {
      machines: {
        stale: false,
        counts: summarizeMachineHealth([]),
        emptyRoster: {
          kind: "withheld_unmeasured",
          reason: "pool timed out",
        },
      },
    });
    expect(fault.level).toBe("amber");
    expect(fault.headline).not.toMatch(/nothing is degrading/i);
    expect(fault.detail).toContain("machine health is unknown");
    // Coord's error text never rides the strip.
    expect(fault.detail).not.toContain("pool timed out");
  });

  it("is amber, not calm, when the counts are kept", () => {
    const kept = deriveHomeStrip(calm(), machines(["healthy"], true));
    expect(kept.level).toBe("amber");
    expect(kept.headline).not.toMatch(/nothing is degrading/i);
    expect(kept.detail).toContain("Machine health is from its last good read.");
  });

  it("an operator decision still outranks a machine", () => {
    const view = parseProjectState({
      needs_me: {
        state: "read",
        total: 1,
        omitted: 0,
        items: [{ id: "q", fork: "Pick", shape: "open_question" }],
      },
    });
    expect(
      deriveHomeStrip(view, machines(["degraded", "degraded", "degraded"]))
        .level
    ).toBe("red");
  });
});

describe("the strip over a Correct? section the page leaves out", () => {
  const body = (correctness: unknown) =>
    parseProjectState({
      generated_at: "2026-10-31T00:00:00Z",
      on_track: {
        state: "read",
        totals: { row_count: 0, classes: {} },
        groups: [],
      },
      correctness,
      needs_me: { state: "read", items: [], total: 0, omitted: 0 },
      degradations: { state: "read", headline: "none", open: [], declared: [] },
      does_not_know: [{ source: "work_units", state: "read" }],
    });
  const machines = {
    stale: false,
    counts: summarizeMachineHealth([{ device_id: "d", state: "healthy" }]),
  };

  it("names no 'correct?' and says correctness is not measured, staying amber", () => {
    const view = body({ state: "not_implemented" });
    const shown = deriveHomeStrip(view, { machines });
    expect(shown.detail).toContain("correct?");
    expect(shown.detail).not.toContain("Correctness is not measured yet.");
    const leftOut = deriveHomeStrip(view, {
      machines,
      correctnessLeftOut: true,
    });
    expect(leftOut.detail ?? "").not.toMatch(/correct\?/);
    expect(leftOut.detail).toContain("Correctness is not measured yet.");
    expect(leftOut.level).toBe("amber");
  });

  it("says nothing about correctness when it was read", () => {
    const s = deriveHomeStrip(body({ state: "read" }), {
      machines,
      correctnessLeftOut: true,
    });
    expect(s.detail ?? "").not.toContain("Correctness is not measured yet.");
  });
});
