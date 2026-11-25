import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applySchedule,
  blankMilestone,
  draftFromBody,
  readSchedule,
  validDate,
} from "./initiativeSchedule";

interface Case {
  name: string;
  text: string;
  expect: {
    programme: string | null;
    milestones: {
      id: string | null;
      name: string;
      date: string;
      shown_by: string;
      work_unit: string | null;
      gate: string | null;
    }[];
    milestones_unreadable: string[];
    calendar: {
      working_day_factor: string;
      breaks: { start: string; end: string; label: string }[];
    } | null;
    calendar_unreadable: string[];
  };
}

// The SAME file backend/tests/test_overview_schedule.py runs through the
// Python parser the overview reads with: this preview must say what it says.
const cases: Case[] = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "initiative-schedule.cases.json"),
    "utf-8"
  )
).cases;

describe("initiativeSchedule reader parity with the backend", () => {
  it("collects the shared fixture cases (a green run must prove it ran)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const c of cases) {
    it(`reads: ${c.name}`, () => {
      const read = readSchedule(c.text);
      expect(read.programme).toBe(c.expect.programme);
      expect(read.milestones).toEqual(c.expect.milestones);
      expect(read.milestonesUnreadable).toEqual(c.expect.milestones_unreadable);
      expect(read.calendar).toEqual(c.expect.calendar);
      expect(read.calendarUnreadable).toEqual(c.expect.calendar_unreadable);
    });
  }
});

describe("validDate", () => {
  it("accepts real ISO dates only", () => {
    expect(validDate("2027-02-01")).toBe("2027-02-01");
    expect(validDate("2026-13-45")).toBeNull();
    expect(validDate("2027-02-30")).toBeNull();
    expect(validDate("~2027-02-01")).toBeNull();
    expect(validDate("soon")).toBeNull();
  });
});

describe("applySchedule", () => {
  const base =
    "---\nstarts: 2026-10-19\nends: 2027-01-22\nfocus: ship v1\nmilestones:\n" +
    "  - {id: V3, name: V3 pilot, date: 2027-01-22}\n---\n# Initiative\n\nProse stays.\n";

  it("adds milestone V4 and the overview reads it back", () => {
    const draft = draftFromBody(base);
    draft.milestones.push({
      ...blankMilestone(),
      id: "V4",
      name: "V4 handover",
      date: "2027-02-01",
      shown_by: "the board",
    });
    const next = applySchedule(base, draft);
    const read = readSchedule(next);
    expect(read.milestonesUnreadable).toEqual([]);
    expect(read.milestones.map((m) => [m.id, m.date, m.shown_by])).toEqual([
      ["V3", "2027-01-22", ""],
      ["V4", "2027-02-01", "the board"],
    ]);
  });

  it("leaves every other frontmatter line and the prose untouched", () => {
    const draft = draftFromBody(base);
    draft.milestones[0] = {
      ...draft.milestones[0],
      name: "V3 pilot, extended",
    };
    const next = applySchedule(base, draft);
    expect(next).toContain(
      "starts: 2026-10-19\nends: 2027-01-22\nfocus: ship v1\n"
    );
    expect(next.endsWith("---\n# Initiative\n\nProse stays.\n")).toBe(true);
    expect(readSchedule(next).milestones[0].name).toBe("V3 pilot, extended");
  });

  it("writes a calendar and reads it back; no calendar block means none", () => {
    const draft = draftFromBody(base);
    draft.calendar = {
      working_day_factor: "0.8",
      breaks: [
        { start: "2026-12-24", end: "2027-01-02", label: "Winter, shutdown" },
      ],
    };
    const withCal = applySchedule(base, draft);
    expect(readSchedule(withCal).calendar).toEqual({
      working_day_factor: "0.8",
      breaks: [
        { start: "2026-12-24", end: "2027-01-02", label: "Winter, shutdown" },
      ],
    });
    draft.calendar = null;
    expect(readSchedule(applySchedule(withCal, draft)).calendar).toBeNull();
    expect(readSchedule(applySchedule(withCal, draft)).calendarPresent).toBe(
      false
    );
  });

  it("keeps an unparseable date as the overview will list it, inventing nothing", () => {
    const draft = draftFromBody(base);
    draft.milestones.push({
      ...blankMilestone(),
      id: "V9",
      name: "V9 vague",
      date: "next spring",
    });
    const read = readSchedule(applySchedule(base, draft));
    expect(read.milestones.map((m) => m.id)).toEqual(["V3"]);
    expect(read.milestonesUnreadable).toEqual([
      "id: V9, name: V9 vague, date: next spring",
    ]);
  });

  it("round-trips the legacy markdown table into the list on first edit", () => {
    const legacy =
      "---\nstarts: 2026-10-19\n---\n| Target date | Milestone | Shown by |\n|---|---|---|\n" +
      "| 2026-11-16 | V0 first slice | the team |\n";
    const draft = draftFromBody(legacy);
    expect(draft.milestones).toHaveLength(1);
    draft.milestones.push({
      ...blankMilestone(),
      id: "V4",
      name: "V4",
      date: "2027-02-01",
    });
    const read = readSchedule(applySchedule(legacy, draft));
    expect(read.listPresent).toBe(true);
    expect(read.milestones.map((m) => m.id)).toEqual(["V0", "V4"]);
  });

  it("creates a frontmatter block for a document that has none", () => {
    const draft = draftFromBody("# prose\n");
    draft.milestones.push({
      ...blankMilestone(),
      id: "V1",
      name: "V1",
      date: "2026-12-01",
    });
    const next = applySchedule("# prose\n", draft);
    expect(next.startsWith("---\nmilestones:\n")).toBe(true);
    expect(next.endsWith("# prose\n")).toBe(true);
    expect(readSchedule(next).milestones).toHaveLength(1);
  });

  it("preserves CRLF line endings", () => {
    const crlf = base.replace(/\n/g, "\r\n");
    const draft = draftFromBody(crlf);
    draft.programme = "prog-plan";
    const next = applySchedule(crlf, draft);
    expect(next.replace(/\r\n/g, "")).not.toContain("\n");
    expect(readSchedule(next).programme).toBe("prog-plan");
  });
});

describe("applySchedule keeps what the panel has no field for", () => {
  it("writes back extra keys of a milestone and of a break", () => {
    const text =
      "---\nmilestones:\n  - id: V1\n    name: Pilot\n    date: 2026-12-01\n    owner: Dana\n" +
      "calendar:\n  working_day_factor: 0.8\n  breaks:\n    - start: 2026-12-24\n      end: 2027-01-02\n      label: Winter\n      kind: shutdown\n---\nx\n";
    const draft = draftFromBody(text);
    draft.milestones[0] = { ...draft.milestones[0]!, shown_by: "the board" };
    const next = applySchedule(text, draft);
    expect(next).toContain("    owner: Dana\n");
    expect(next).toContain("      kind: shutdown\n");
    expect(readSchedule(next).milestones[0]?.shown_by).toBe("the board");
  });

  it("removing the last milestone does not bring the legacy table back", () => {
    const text =
      "---\nstarts: 2026-10-19\n---\n| Target date | Milestone | Shown by |\n|---|---|---|\n| 2026-11-16 | V0 first slice | the team |\n";
    const draft = draftFromBody(text);
    draft.milestones = [];
    const read = readSchedule(applySchedule(text, draft));
    expect(read.listPresent).toBe(true);
    expect(read.milestones).toEqual([]);
  });

  it("reports an inline calendar as unreadable and as inline", () => {
    const read = readSchedule(
      "---\ncalendar: {working_day_factor: 0.8}\n---\nx\n"
    );
    expect(read.calendar).toBeNull();
    expect(read.calendarInline).toBe(true);
    expect(read.calendarUnreadable).toEqual([
      "calendar: {working_day_factor: 0.8}",
    ]);
  });
});

describe("review follow-ups", () => {
  it("carries an inline calendar's factor into the draft instead of blanking it", () => {
    const draft = draftFromBody(
      "---\ncalendar: {working_day_factor: 0.8}\n---\nx\n"
    );
    expect(draft.calendar?.working_day_factor).toBe("0.8");
  });

  it("keeps target_date as an extra key when date is also set", () => {
    const text =
      "---\nmilestones:\n  - id: V1\n    name: Pilot\n    date: 2026-12-01\n    target_date: 2027-01-01\n---\nx\n";
    const next = applySchedule(text, draftFromBody(text));
    expect(next).toContain("target_date: 2027-01-01");
    expect(readSchedule(next).milestones[0]?.date).toBe("2026-12-01");
  });

  it("reads years below 100 literally, as the backend does", () => {
    expect(validDate("0050-05-05")).toBe("0050-05-05");
  });
});
