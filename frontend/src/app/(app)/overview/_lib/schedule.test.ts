import { describe, expect, it } from "vitest";
import {
  LABEL_TABLES,
  PHASE_STATE_WORDS,
  countPhases,
  describeUnknown,
  gateVerdictWord,
  milestoneStatusWord,
  figureDay,
  mergeMilestones,
  missingLabels,
  nextMilestone,
  normaliseName,
  overlayPhases,
  phaseStateWord,
} from "./schedule";
import { PHASE_STATES, UNKNOWN_REASONS } from "./schedule-api";
import { entered, known, milestone, phase, unknown } from "./schedule-fixtures";
import type { Milestone, PhaseProgress } from "./timeline-api";

describe("plain-language labels are total", () => {
  it.each(LABEL_TABLES.map((t) => [t.name, t] as const))(
    "every %s has a non-empty label",
    (_name, table) => {
      expect(table.states.length).toBeGreaterThan(0);
      expect(missingLabels(table.states, table.labels)).toEqual([]);
    }
  );

  it("covers every closed set the wire declares", () => {
    const names = LABEL_TABLES.map((t) => t.name);
    for (const expected of [
      "phase state",
      "milestone status",
      "gate verdict",
      "unknown reason",
      "source kind",
      "basis",
      "forecast position",
    ])
      expect(names).toContain(expected);
  });

  it("FAILS when a state is added without a label (planted gap)", () => {
    const withNewState = [...PHASE_STATES, "paused"];
    expect(missingLabels(withNewState, PHASE_STATE_WORDS)).toEqual(["paused"]);
    const blank = { ...PHASE_STATE_WORDS, done: "  " };
    expect(missingLabels(PHASE_STATES, blank)).toEqual(["done"]);
  });

  it("never shows 'Planned' for the not-confirmed state, and says an unseen state plainly", () => {
    expect(phaseStateWord("not_confirmed")).toBe("Not confirmed");
    expect(phaseStateWord("not_confirmed")).not.toBe(phaseStateWord("planned"));
    // A state a newer server serves: said plainly, not echoed as an identifier.
    expect(phaseStateWord("paused" as never)).toBe("Unrecognised");
    expect(gateVerdictWord("paused" as never)).toBe("Unrecognised");
    expect(milestoneStatusWord("paused" as never)).toBe("Unrecognised");
  });

  it("gives every unknown reason a sentence without an identifier", () => {
    for (const reason of UNKNOWN_REASONS) {
      const text = describeUnknown({ unknown_reason: reason }).reason;
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/_/);
    }
  });
});

describe("an unknown figure", () => {
  it("says since when, and why, in words", () => {
    expect(
      describeUnknown({
        unknown_since: "2026-11-21T10:00:00Z",
        unknown_reason: "coord_unreachable",
      })
    ).toEqual({
      headline: "Not available since 21 Nov 2026",
      reason: "the project record could not be reached",
    });
  });

  it("without a since says only 'Not available'", () => {
    expect(describeUnknown({ unknown_reason: "not_recorded" }).headline).toBe(
      "Not available"
    );
  });

  it("carries no day, so nothing can be drawn from it", () => {
    expect(figureDay(unknown("not_recorded"))).toEqual({
      kind: "unknown",
      day: null,
    });
    expect(figureDay(known("2026-12-01"))).toEqual({
      kind: "coord",
      day: "2026-12-01",
    });
    expect(figureDay(entered("2026-12-02")).kind).toBe("entered");
  });
});

function typedPhase(over: Partial<PhaseProgress>): PhaseProgress {
  return {
    id: "p-a",
    estimate_id: "e1",
    code: "F1",
    name: "Foundation",
    sort_order: 0,
    planned_start: null,
    planned_end: null,
    gate_criteria: "",
    actual_start: null,
    actual_end: null,
    gate_status: "pending",
    gate_decided_at: null,
    gate_notes: "",
    version: 1,
    updated_at: null,
    updated_by: null,
    ...over,
  };
}

describe("overlayPhases", () => {
  it("matches only by EQUAL code, never fuzzily", () => {
    const o = overlayPhases(
      [
        typedPhase({ id: "a", code: "F1" }),
        typedPhase({ id: "b", code: "f2" }), // case differs: not F2
        typedPhase({ id: "c", code: "Build" }),
      ],
      [phase(1, "F1", "F1 Foundation"), phase(2, "F2", "F2 Release")]
    );
    expect([...o.matched.keys()]).toEqual(["a"]);
    expect(o.coordOnly.map((p) => p.code)).toEqual(["F2"]);
    expect(o.enteredOnly).toEqual(["b", "c"]);
  });

  it("shows coord's date and keeps a contradicting entered one beside it", () => {
    const o = overlayPhases(
      [typedPhase({ id: "a", code: "F1", actual_end: "2026-11-14" })],
      [
        phase(1, "F1", "F1 Foundation", {
          actual_start: known("2026-10-20"),
          actual_end: known("2026-11-16"),
        }),
      ]
    );
    const m = o.matched.get("a")!;
    expect(m.end).toMatchObject({
      day: "2026-11-16",
      from: "coord",
      entered_disagrees: "2026-11-14",
    });
    expect(m.start.entered_disagrees).toBeNull();
    expect(o.disagreements).toBe(1);
  });

  it("an entered value equal to coord's is no disagreement", () => {
    const o = overlayPhases(
      [typedPhase({ id: "a", code: "F1", actual_end: "2026-11-16" })],
      [phase(1, "F1", "F1", { actual_end: known("2026-11-16") })]
    );
    expect(o.disagreements).toBe(0);
  });

  it("where coord is unknown the entered value stands in, labelled entered", () => {
    const o = overlayPhases(
      [typedPhase({ id: "a", code: "F1", actual_end: "2026-11-14" })],
      [
        phase(1, "F1", "F1", {
          actual_end: unknown("coord_unreachable", "2026-11-20T00:00:00Z"),
        }),
      ]
    );
    expect(o.matched.get("a")!.end).toMatchObject({
      day: "2026-11-14",
      from: "entered",
    });
    expect(o.disagreements).toBe(0);
  });

  it("with neither, the date stays unknown and carries its reason", () => {
    const o = overlayPhases(
      [typedPhase({ id: "a", code: "F1" })],
      [phase(1, "F1", "F1", { actual_end: unknown("not_recorded") })]
    );
    const end = o.matched.get("a")!.end;
    expect(end.from).toBe("unknown");
    expect(end.day).toBeNull();
    expect(end.resolved?.unknown_reason).toBe("not_recorded");
  });

  it("with no coord phases at all, nothing matches and nothing disagrees", () => {
    const o = overlayPhases([typedPhase({ id: "a" })], null);
    expect(o.matched.size).toBe(0);
    expect(o.coordOnly).toEqual([]);
    expect(o.enteredOnly).toEqual(["a"]);
  });
});

function typedMilestone(over: Partial<Milestone>): Milestone {
  return {
    id: "m1",
    title: "Pilot go-live",
    description: "",
    kind: "milestone",
    phase_id: null,
    phase_code: null,
    target_date: "2026-12-18",
    completed_date: null,
    status: "planned",
    version: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    created_by: null,
    updated_by: null,
    ...over,
  };
}

describe("mergeMilestones", () => {
  it("collapses a typed and a coord milestone only when normalised name AND date are equal", () => {
    const lane = mergeMilestones(
      [typedMilestone({ title: "  pilot   GO-LIVE " })],
      [milestone("Pilot go-live", "2026-12-18")]
    );
    expect(lane).toHaveLength(1);
    expect(lane[0]!.sources).toEqual(["coord", "entered"]);
  });

  it("lists both when the dates differ", () => {
    const lane = mergeMilestones(
      [typedMilestone({ target_date: "2026-12-19" })],
      [milestone("Pilot go-live", "2026-12-18")]
    );
    expect(lane.map((m) => m.sources)).toEqual([["coord"], ["entered"]]);
  });

  it("lists both when the names differ", () => {
    const lane = mergeMilestones(
      [typedMilestone({ title: "Pilot launch" })],
      [milestone("Pilot go-live", "2026-12-18")]
    );
    expect(lane).toHaveLength(2);
  });

  it("an undated coord milestone is kept, undated, never dropped or given a date", () => {
    const lane = mergeMilestones([], [milestone("Someday", null)]);
    expect(lane).toHaveLength(1);
    expect(lane[0]!.date).toBeNull();
    expect(lane[0]!.dateFrom).toBe("unknown");
  });

  it("a coord milestone with no link reads Not confirmed, not met and not planned", () => {
    const [m] = mergeMilestones([], [milestone("Review", "2026-12-01")]);
    expect(m!.statusWord).toBe("Not confirmed");
    expect(m!.tone).toBe("unconfirmed");
  });

  it("a coord milestone whose status is unknown keeps its reason and a distinct tone", () => {
    const [m] = mergeMilestones(
      [],
      [
        milestone("Review", "2026-12-01", "met", {
          status: unknown("coord_unreachable", "2026-11-21T10:00:00Z"),
        }),
      ]
    );
    expect(m!.statusWord).toBe(
      "Not available since 21 Nov 2026 — the project record could not be reached"
    );
    expect(m!.tone).toBe("unknown");
    expect(m!.tone).not.toBe("unconfirmed");
  });

  it("table lookups ignore inherited names like constructor and toString", () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(phaseStateWord(name as never)).toBe("Unrecognised");
      expect(gateVerdictWord(name as never)).toBe("Unrecognised");
      expect(milestoneStatusWord(name as never)).toBe("Unrecognised");
      const [m] = mergeMilestones(
        [],
        [milestone("Review", "2026-12-01", name as never)]
      );
      expect(m!.statusWord).toBe("Unrecognised");
      expect(m!.tone).toBe("unknown");
    }
    expect(missingLabels(["constructor"], PHASE_STATE_WORDS)).toEqual([
      "constructor",
    ]);
  });

  it("an unrecognised coord milestone status reads Unrecognised, not a concrete one", () => {
    const [m] = mergeMilestones(
      [],
      [milestone("Review", "2026-12-01", "paused" as never)]
    );
    expect(m!.statusWord).toBe("Unrecognised");
    expect(m!.tone).toBe("unknown");
  });

  it("sorts by date with undated last, and works with coord unknown", () => {
    const lane = mergeMilestones(
      [
        typedMilestone({ id: "z", title: "Late", target_date: "2027-01-10" }),
        typedMilestone({ id: "y", title: "Early", target_date: "2026-12-01" }),
      ],
      null
    );
    expect(lane.map((m) => m.title)).toEqual(["Early", "Late"]);
    expect(lane.every((m) => m.sources[0] === "entered")).toBe(true);
  });

  it("normaliseName case-folds and collapses whitespace", () => {
    expect(normaliseName("  A \t b ")).toBe("a b");
  });
});

describe("the header's facts", () => {
  it("nextMilestone is the first dated, not-met milestone from today on", () => {
    const lane = mergeMilestones(
      [],
      [
        milestone("Past", "2026-10-01"),
        milestone("Done", "2026-12-01", "met"),
        milestone("Next", "2026-12-18"),
        milestone("Undated", null),
      ]
    );
    expect(nextMilestone(lane, "2026-11-25")?.title).toBe("Next");
    expect(nextMilestone(lane, "2027-01-01")).toBeNull();
  });

  it("countPhases keeps not-confirmed and unreadable apart from planned", () => {
    const c = countPhases([
      phase(1, "A", "A", { state: "done" }),
      phase(2, "B", "B", { state: "planned" }),
      phase(3, "C", "C"),
      phase(4, "D", "D", { state: "not_confirmed" }),
      { ...phase(5, "E", "E"), state: unknown("coord_unreachable") },
    ]);
    expect(c).toMatchObject({
      total: 5,
      done: 1,
      planned: 1,
      notConfirmed: 2,
      unavailable: 1,
    });
  });
});
