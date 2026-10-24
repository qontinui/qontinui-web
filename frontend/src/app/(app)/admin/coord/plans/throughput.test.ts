/**
 * `throughput.ts` — coord's day buckets laid out with no zero-fill (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 4).
 */

import { describe, expect, it } from "vitest";
import { deriveThroughput, sinceForRange } from "./throughput";

const ENVELOPE = {
  since: "2026-09-06T00:00:00Z",
  until: "2026-10-06T12:00:00Z",
  bucket: "day",
  timezone: "UTC",
  statuses: ["in_progress", "shipped"],
};

describe("deriveThroughput", () => {
  it("an empty bucket list is 'no data in this range', not a row of zeros", () => {
    const r = deriveThroughput({ ...ENVELOPE, count: 0, buckets: [] });
    expect(r.state).toBe("empty");
  });

  it("lays out only the days coord returned, and only the series it returned", () => {
    const r = deriveThroughput({
      ...ENVELOPE,
      count: 3,
      buckets: [
        { day: "2026-09-10", to_status: "shipped", count: 2 },
        { day: "2026-09-08", to_status: "in_progress", count: 4 },
        { day: "2026-09-10", to_status: "in_progress", count: 1 },
      ],
    });
    expect(r.state).toBe("loaded");
    if (r.state !== "loaded") return;
    expect(r.days.map((d) => d.day)).toEqual(["2026-09-08", "2026-09-10"]);
    // 09-08 had no shipped bucket: ABSENT, not 0.
    expect(r.days[0]).toEqual({ day: "2026-09-08", started: 4 });
    expect("shipped" in r.days[0]).toBe(false);
    expect(r.days[1]).toEqual({ day: "2026-09-10", shipped: 2, started: 1 });
    expect(r.shippedUnitDays).toBe(2);
    expect(r.startedUnitDays).toBe(5);
    expect(r.since).toBe(ENVELOPE.since);
  });

  it("ignores statuses it does not chart, and is empty when only those came back", () => {
    const r = deriveThroughput({
      ...ENVELOPE,
      buckets: [{ day: "2026-09-10", to_status: "blocked", count: 9 }],
    });
    expect(r.state).toBe("empty");
  });

  it("refuses a body with no buckets list rather than reading it as empty", () => {
    expect(deriveThroughput({ items: [] }).state).toBe("unparseable");
    expect(deriveThroughput(null).state).toBe("unparseable");
    expect(
      deriveThroughput({ buckets: [{ day: "2026-09-10", count: "2" }] }).state
    ).toBe("unparseable");
  });
});

describe("sinceForRange", () => {
  it("is the UTC date N days back", () => {
    expect(sinceForRange(30, new Date("2026-10-06T23:30:00Z"))).toBe(
      "2026-09-06"
    );
    expect(sinceForRange(7, new Date("2026-03-03T00:10:00Z"))).toBe(
      "2026-02-24"
    );
  });
});
