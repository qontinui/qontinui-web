import { describe, expect, it } from "vitest";
import {
  LABEL_TABLES,
  PHASE_STATE_WORDS,
  countPhases,
  describeUnknown,
  gateVerdictWord,
  milestoneStatusWord,
  figureDay,
  milestoneLane,
  missingLabels,
  nextMilestone,
  normaliseName,
  phaseStateWord,
} from "./schedule";
import { PHASE_STATES, UNKNOWN_REASONS } from "./schedule-api";
import { known, milestone, phase, unknown } from "./schedule-fixtures";

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
  });
});

describe("milestoneLane", () => {
  it("an undated coord milestone is kept, undated, never dropped or given a date", () => {
    const lane = milestoneLane([milestone("Someday", null)]);
    expect(lane).toHaveLength(1);
    expect(lane[0]!.date).toBeNull();
  });

  it("a coord milestone with no link reads Not confirmed, not met and not planned", () => {
    const [m] = milestoneLane([milestone("Review", "2026-12-01")]);
    expect(m!.statusWord).toBe("Not confirmed");
    expect(m!.tone).toBe("unconfirmed");
  });

  it("a coord milestone whose status is unknown keeps its reason and a distinct tone", () => {
    const [m] = milestoneLane([
      milestone("Review", "2026-12-01", "met", {
        status: unknown("coord_unreachable", "2026-11-21T10:00:00Z"),
      }),
    ]);
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
      const [m] = milestoneLane([
        milestone("Review", "2026-12-01", name as never),
      ]);
      expect(m!.statusWord).toBe("Unrecognised");
      expect(m!.tone).toBe("unknown");
    }
    expect(missingLabels(["constructor"], PHASE_STATE_WORDS)).toEqual([
      "constructor",
    ]);
  });

  it("an unrecognised coord milestone status reads Unrecognised, not a concrete one", () => {
    const [m] = milestoneLane([
      milestone("Review", "2026-12-01", "paused" as never),
    ]);
    expect(m!.statusWord).toBe("Unrecognised");
    expect(m!.tone).toBe("unknown");
  });

  it("sorts by date with undated last, and works with coord unknown", () => {
    const lane = milestoneLane([
      milestone("Late", "2027-01-10"),
      milestone("Undated", null),
      milestone("Early", "2026-12-01"),
    ]);
    expect(lane.map((m) => m.title)).toEqual(["Early", "Late", "Undated"]);
    expect(milestoneLane(null)).toEqual([]);
  });

  it("normaliseName case-folds and collapses whitespace", () => {
    expect(normaliseName("  A \t b ")).toBe("a b");
  });
});

describe("the header's facts", () => {
  it("nextMilestone is the first dated, not-met milestone from today on", () => {
    const lane = milestoneLane([
      milestone("Past", "2026-10-01"),
      milestone("Done", "2026-12-01", "met"),
      milestone("Next", "2026-12-18"),
      milestone("Undated", null),
    ]);
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
