/**
 * The console's timestamp formatters.
 *
 * `time.ts` shipped in Phase 1 of plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` with no test of
 * its own — it was covered only indirectly, through the surfaces that render
 * it. That was survivable while it had one hard-coded behaviour. It stopped
 * being survivable once it grew the two knobs (`now`, `absent`) that let the
 * five private copies migrate onto it: those copies each had their OWN absent
 * string, and the whole point of folding them in is that the fold is
 * behaviour-preserving. So the cases pinned here are deliberately the ones the
 * migrated call sites depend on, not a generic formatter suite.
 */

import { describe, expect, it } from "vitest";

import { absoluteTime, relativeTime } from "./time";

/** A fixed clock, so every expectation below is exact rather than approximate. */
const NOW = Date.parse("2026-08-29T12:00:00.000Z");

/** `NOW` minus a duration, as the ISO string a caller would actually pass. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("floors each unit and switches at the boundary, not near it", () => {
    expect(relativeTime(ago(0), { now: NOW })).toBe("0s ago");
    expect(relativeTime(ago(59 * SECOND), { now: NOW })).toBe("59s ago");
    expect(relativeTime(ago(MINUTE), { now: NOW })).toBe("1m ago");
    expect(relativeTime(ago(59 * MINUTE), { now: NOW })).toBe("59m ago");
    expect(relativeTime(ago(HOUR), { now: NOW })).toBe("1h ago");
    expect(relativeTime(ago(23 * HOUR), { now: NOW })).toBe("23h ago");
    expect(relativeTime(ago(DAY), { now: NOW })).toBe("1d ago");
    expect(relativeTime(ago(400 * DAY), { now: NOW })).toBe("400d ago");
  });

  it("rounds DOWN rather than to nearest — 119s is 1m, never 2m", () => {
    // The one behavioural difference from `execute/ScheduleListItem.tsx`'s
    // same-named helper, which rounds. That is why it did not migrate here.
    expect(relativeTime(ago(119 * SECOND), { now: NOW })).toBe("1m ago");
  });

  it("defaults the clock to now when none is injected", () => {
    expect(relativeTime(new Date().toISOString())).toMatch(/^\ds ago$/);
  });

  describe("no usable timestamp", () => {
    it("renders `never` by default for an absent one", () => {
      expect(relativeTime(null)).toBe("never");
      expect(relativeTime(undefined)).toBe("never");
      expect(relativeTime("")).toBe("never");
    });

    it("renders `absent` for an UNPARSEABLE one, not a duration", () => {
      // The regression this pins: an unparseable stamp used to fall into the
      // `"just now"` branch alongside a future one, because `NaN < 0` is false.
      // That reported a parse failure as the calmest possible reading.
      expect(relativeTime("not-a-date", { now: NOW })).toBe("never");
      expect(relativeTime("2026-13-45T99:99:99Z", { now: NOW })).toBe("never");
    });

    it("uses the caller's placeholder for BOTH absent and unparseable", () => {
      // The four migrated agent dashboards rely on exactly this: their private
      // copies returned the same `—` for a null stamp and for a bad one.
      expect(relativeTime(null, { absent: "—" })).toBe("—");
      expect(relativeTime("not-a-date", { now: NOW, absent: "—" })).toBe("—");
      expect(
        relativeTime("not-a-date", { now: NOW, absent: "an unknown time ago" })
      ).toBe("an unknown time ago");
    });
  });

  describe("a negative delta", () => {
    it("reads as `just now`, not as the absent placeholder", () => {
      // Clock skew between the server and the browser is ordinary and IS about
      // now — the opposite of a parse failure, and the reason the two branches
      // are now separate.
      const future = new Date(NOW + HOUR).toISOString();
      expect(relativeTime(future, { now: NOW })).toBe("just now");
      expect(relativeTime(future, { now: NOW, absent: "—" })).toBe("just now");
    });

    it("covers SUB-SECOND skew, not just a genuinely future stamp", () => {
      // The migrated dashboards' private copies clamped with `Math.max(0, …)`,
      // so every negative delta — including the 1ms-to-1s skew that is by far
      // the common case — rendered `0s ago`. This pins the wider half of that
      // disclosed change, which "a future timestamp" undersells.
      expect(relativeTime(new Date(NOW + 1).toISOString(), { now: NOW })).toBe(
        "just now"
      );
      expect(
        relativeTime(new Date(NOW + 999).toISOString(), { now: NOW })
      ).toBe("just now");
    });
  });
});

describe("absoluteTime", () => {
  it("names the unknown rather than rendering an empty title", () => {
    expect(absoluteTime(null)).toBe("time unknown");
    expect(absoluteTime(undefined)).toBe("time unknown");
    expect(absoluteTime("")).toBe("time unknown");
    expect(absoluteTime("not-a-date")).toBe("time unknown");
  });

  it("formats a real timestamp in the viewer's locale", () => {
    expect(absoluteTime(new Date(NOW).toISOString())).toBe(
      new Date(NOW).toLocaleString()
    );
  });
});
