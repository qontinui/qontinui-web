import { describe, expect, it } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import {
  BLOCK_STATES,
  UNIT_CLASSES,
  parseProjectState,
  type OnTrackView,
  type UnitClass,
} from "@/components/admin/coord/coordHomeStatus";
import {
  CLASS_BUCKET,
  PROGRESS_BUCKETS,
  progressFromOnTrack,
  recentlyFinishedFrom,
  titleOf,
} from "./progress";

const zeros = (): Record<UnitClass, number> =>
  Object.fromEntries(UNIT_CLASSES.map((c) => [c, 0])) as Record<
    UnitClass,
    number
  >;

function onTrack(
  classes: Partial<Record<UnitClass, number>> | Record<string, unknown>,
  state = "read"
): OnTrackView {
  const all = { ...zeros(), ...classes };
  const rowCount = Object.values(all).reduce(
    (a: number, b) => a + (typeof b === "number" ? b : 0),
    0
  );
  return parseProjectState({
    on_track: {
      state,
      totals: { row_count: rowCount, classes: all },
      groups: [],
    },
  })!.onTrack;
}

describe("progressFromOnTrack — the door's classes in business words", () => {
  it("maps every door class exactly as documented", () => {
    expect(CLASS_BUCKET).toEqual({
      shipped: "done",
      in_flight: "in_progress",
      stalled: "in_progress",
      blocked_on_dependency: "blocked",
      waiting_on_gate: "blocked",
      not_started: "planned",
      closed_other: null,
      off_vocabulary: "unknown",
      unset: "unknown",
    });
  });

  it("buckets the door's totals", () => {
    const r = progressFromOnTrack(
      onTrack({
        shipped: 4,
        in_flight: 2,
        stalled: 1,
        blocked_on_dependency: 1,
        waiting_on_gate: 2,
        not_started: 3,
        closed_other: 5,
        off_vocabulary: 1,
        unset: 1,
      }),
      null
    );
    expect(r.counted).toBe(true);
    if (!r.counted) return;
    expect(r.progress.counts).toEqual({
      done: 4,
      in_progress: 3,
      blocked: 3,
      planned: 3,
      unknown: 2,
    });
    // Closed work will not be done and counts toward nothing.
    expect(r.progress.total).toBe(15);
  });

  it("keeps unrecognised statuses in the total, so they cannot inflate done", () => {
    const r = progressFromOnTrack(
      onTrack({ shipped: 1, off_vocabulary: 2 }),
      null
    );
    if (!r.counted) throw new Error("expected a count");
    expect(r.progress.counts.unknown).toBe(2);
    expect(r.progress.counts.done / r.progress.total).toBeCloseTo(1 / 3);
  });

  it("has no bucket the door cannot source (no 'Ready to start')", () => {
    expect(PROGRESS_BUCKETS.map((b) => b.key)).toEqual([
      "done",
      "in_progress",
      "blocked",
      "planned",
      "unknown",
    ]);
  });

  it.each(BLOCK_STATES.filter((s) => s !== "read"))(
    "shows NO counts when on_track is %s — unknown, never zeros",
    (state) => {
      const r = progressFromOnTrack(onTrack({ shipped: 3 }, state), null);
      expect(r.counted).toBe(false);
    }
  );

  it("treats a missing class as an uncounted reading, not a zero", () => {
    const view = parseProjectState({
      on_track: {
        state: "read",
        totals: { row_count: 3, classes: { shipped: 3 } },
      },
    })!.onTrack;
    expect(progressFromOnTrack(view, null).counted).toBe(false);
  });

  it("passes the recently finished list through", () => {
    const recent = { items: [], partial: false };
    const r = progressFromOnTrack(onTrack({}), recent);
    if (!r.counted) throw new Error("expected a count");
    expect(r.progress.recentlyFinished).toBe(recent);
  });
});

const row = (
  slug: string,
  status: string,
  extra: Partial<CoordPlanRow> = {}
): CoordPlanRow => ({ slug, status, ...extra });

describe("recentlyFinishedFrom", () => {
  it("lists the most recently finished work first, and only dated work", () => {
    const r = recentlyFinishedFrom(
      [
        row("2026-01-01-old", "shipped", {
          title: "Old",
          first_shipped_at: "2026-02-01T00:00:00Z",
        }),
        row("2026-03-01-new", "shipped", {
          title: "New",
          first_shipped_at: "2026-04-01T00:00:00Z",
        }),
        row("2026-03-02-undated", "shipped"),
      ],
      { fetchLimit: 500, recent: 5 }
    );
    expect(r.items.map((f) => f.title)).toEqual(["New", "Old"]);
    expect(r.partial).toBe(false);
  });

  it("drops merge-shepherd bookkeeping units even if the server kept them", () => {
    const r = recentlyFinishedFrom(
      [
        row("shepherd-pr-12", "shipped", {
          first_shipped_at: "2026-01-01T00:00:00Z",
        }),
      ],
      { fetchLimit: 500 }
    );
    expect(r.items).toEqual([]);
  });

  it("marks a full page as partial", () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(`p${i}`, "shipped"));
    expect(recentlyFinishedFrom(rows, { fetchLimit: 3 }).partial).toBe(true);
    expect(recentlyFinishedFrom(rows, { fetchLimit: 4 }).partial).toBe(false);
  });
});

describe("titleOf", () => {
  it("prefers the title and otherwise humanises the slug", () => {
    expect(titleOf({ slug: "2026-09-19-x", title: "Nice title" })).toBe(
      "Nice title"
    );
    expect(titleOf({ slug: "2026-09-19-partner-portal-login" })).toBe(
      "Partner portal login"
    );
  });
});
