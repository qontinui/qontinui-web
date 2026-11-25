import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Derived only (plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`,
 * D5): the schedule code carries no entered-value overlay. This fails when the
 * vocabulary of the removed overlay comes back into the schedule's files.
 */

const OVERVIEW = join(__dirname, "..");
const SCHEDULE_FILES = [
  "_lib/schedule.ts",
  "_lib/schedule-api.ts",
  "_lib/schedule-fixtures.ts",
  "_hooks/useSchedule.ts",
  "timeline/page.tsx",
  "timeline/_components/ScheduleSection.tsx",
  "timeline/_components/ScheduleHeader.tsx",
  "timeline/_components/ScheduleChart.tsx",
  "timeline/_components/ProvenanceLine.tsx",
  "timeline/_components/UnknownFigure.tsx",
];

const OVERLAY_VOCABULARY =
  /entered_by|disagrees|disagreement|basis:\s*entered|["']entered["']|enteredBy|entered_only|overlayPhases|mergeMilestones|ScheduleBasis/;

describe("the schedule carries no entered-value overlay", () => {
  it.each(SCHEDULE_FILES)("%s", (file) => {
    const text = readFileSync(join(OVERVIEW, file), "utf8");
    expect(text.match(OVERLAY_VOCABULARY)).toBeNull();
  });

  it("the check can fail", () => {
    for (const planted of [
      "entered_by",
      "x.disagrees",
      "disagreement_count",
      "basis: entered",
      'state: "entered"',
      "enteredBy(r)",
    ])
      expect(planted).toMatch(OVERLAY_VOCABULARY);
  });
});
