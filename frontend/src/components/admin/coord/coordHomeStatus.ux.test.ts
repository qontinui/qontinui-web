/**
 * coordHomeStatus — the derivations the 2026-10-31 UX pass on
 * `/admin/coord/home` added or changed (plan
 * `2026-10-23-console-presentation-spaces` Phase 2 follow-up). The page-level
 * half is `app/(app)/admin/coord/home/page.ux.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import {
  deriveHomeStrip,
  noRecordedChangeBadgeLabel,
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
