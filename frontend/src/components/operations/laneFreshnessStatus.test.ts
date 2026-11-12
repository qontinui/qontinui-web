import { describe, expect, it } from "vitest";
import {
  LANE_FRESHNESS_ATTENTION_BY_KIND,
  LANE_FRESHNESS_BADGE_CLASS,
  formatLaneAge,
  laneName,
  resolveLaneFreshness,
} from "./laneFreshnessStatus";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";

/**
 * The four wire states of coord's `stale_lanes`, enumerated rather than
 * sampled: `[]` (measured fresh), non-empty (measured stale), `null` (the read
 * failed) and absent (a coord predating the field). The two UNKNOWN arms are
 * the point, because the defect this renders is silence read as health.
 */
describe("resolveLaneFreshness", () => {
  it("reads [] as a measured fresh verdict", () => {
    const s = resolveLaneFreshness({
      stale_lanes: [],
      sample_stale_after_secs: 120,
    });
    expect(s.kind).toBe("fresh");
    expect(s.measured).toBe(true);
    expect(s.attention).toBe("none");
    expect(s.reason).toContain("2m");
  });

  it("names the stale lane with its instance and age: the 2026-11-04 fixture", () => {
    // Host lane fresh at 24 s, so coord names only the wsl lane (697 s vs 120 s).
    const s = resolveLaneFreshness({
      stale_lanes: [{ lane: "wsl", lane_instance: "Ubuntu", age_secs: 697 }],
      sample_stale_after_secs: 120,
    });
    expect(s.kind).toBe("stale");
    expect(s.measured).toBe(true);
    expect(s.label).toBe("stale lane: wsl/Ubuntu 12m");
    expect(s.reason).toContain("past the 2m threshold");
    expect(s.attention).toBe("waiting");
  });

  it("says 'still heartbeats' only for a device coord overlaid to stale", () => {
    const lanes = [{ lane: "wsl", lane_instance: "Ubuntu", age_secs: 697 }];
    const overlaid = resolveLaneFreshness({
      stale_lanes: lanes,
      state: "stale",
    });
    expect(overlaid.reason).toContain("still heartbeats");
    const partitioned = resolveLaneFreshness({
      stale_lanes: lanes,
      state: "partitioned",
    });
    expect(partitioned.kind).toBe("stale");
    expect(partitioned.reason).not.toContain("heartbeats");
  });

  it("names a malformed value as unreadable, not as a failed read", () => {
    const s = resolveLaneFreshness({
      stale_lanes: "oops" as unknown as null,
    });
    expect(s.kind).toBe("unknown");
    expect(s.reason).toMatch(/cannot read/);
    expect(s.reason).not.toMatch(/read failed/);
  });

  it("orders several stale lanes stalest first", () => {
    const s = resolveLaneFreshness({
      stale_lanes: [
        { lane: "host", lane_instance: null, age_secs: 300 },
        { lane: "wsl", lane_instance: "Ubuntu", age_secs: 9000 },
      ],
      sample_stale_after_secs: 120,
    });
    expect(s.lanes.map(laneName)).toEqual(["wsl/Ubuntu", "host"]);
    expect(s.label).toBe("stale lane: wsl/Ubuntu 3h, host 5m");
  });

  it("reads null as UNKNOWN (read failed), never as no stale lanes", () => {
    const s = resolveLaneFreshness({
      stale_lanes: null,
      sample_stale_after_secs: 120,
    });
    expect(s.kind).toBe("unknown");
    expect(s.measured).toBe(false);
    expect(s.attention).toBe("waiting");
    expect(s.label).not.toMatch(/none|lanes fresh/i);
    expect(s.reason).toMatch(/read failed/);
  });

  it("reads an absent field as UNKNOWN (coord predates it), with its own reason", () => {
    const s = resolveLaneFreshness({ sample_stale_after_secs: 120 });
    expect(s.kind).toBe("unknown");
    expect(s.measured).toBe(false);
    expect(s.label).not.toMatch(/none|lanes fresh/i);
    expect(s.reason).toMatch(/predates/);
  });

  it("does not invent a threshold coord did not send", () => {
    const s = resolveLaneFreshness({
      stale_lanes: [{ lane: "host", age_secs: 500 }],
      sample_stale_after_secs: null,
    });
    expect(s.kind).toBe("stale");
    expect(s.reason).not.toMatch(/threshold/);
  });
});

describe("lane freshness palette", () => {
  it("paints unknown at the ignorance floor, never calm", () => {
    expect(LANE_FRESHNESS_BADGE_CLASS.unknown).toBe(UNKNOWN_AMBER);
    expect(LANE_FRESHNESS_ATTENTION_BY_KIND.unknown).not.toBe("none");
  });
});

describe("formatLaneAge", () => {
  it.each([
    [45, "45s"],
    [697, "12m"],
    [9000, "3h"],
    [400000, "5d"],
    [-1, "?"],
    [Number.NaN, "?"],
  ])("%s -> %s", (secs, out) => {
    expect(formatLaneAge(secs)).toBe(out);
  });
});
