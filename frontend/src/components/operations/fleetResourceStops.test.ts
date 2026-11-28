/**
 * The pressure-stop wording rules (plan
 * `2026-11-24-pressure-stops-record-box-stats-in-coord` Phase 4). Each case
 * asserts a literal string, including the arms where the honest answer is
 * "unknown" — a `0` or a blank there is the defect these rules exist to stop.
 */

import { describe, expect, it } from "vitest";
import {
  calibrationSummary,
  formatObservedVsLimit,
  formatSessions,
  formatStopCount,
  guardLaneLabel,
  stopLaneLabel,
  suppressionNote,
} from "./fleetResourceStops";
import type { ResourceStopRow } from "./fleetResourceStops";

const GIB = 1024 ** 3;

function row(over: Partial<ResourceStopRow> = {}): ResourceStopRow {
  return {
    event_id: "e-1",
    device_id: "d-1",
    client_event_id: "c-1",
    observed_at: "2026-11-24T09:00:00Z",
    recorded_at: "2026-11-24T09:00:01Z",
    stop_kind: "refused_spawn",
    lane: "memory_free_commit",
    guard_lane: "wsl",
    severity: "critical",
    what_class: "terminal_spawn",
    observed: 3 * GIB,
    limit_value: 4 * GIB,
    reason: null,
    session_count_terminal: 7,
    session_count_live_claude: 5,
    active_ci_runners: 2,
    ci_jobs_queued: null,
    calibration: {},
    fleet_calibration: null,
    suppressed_count: 0,
    dropped_before: 0,
    box_stats: {},
    ...over,
  };
}

describe("lane and pool wording", () => {
  it("uses the headline words the guard dialog names", () => {
    expect(stopLaneLabel("memory_free_commit")).toBe("Low memory");
    expect(stopLaneLabel("thread_pressure")).toBe("High thread count");
  });

  it("keeps a lane this build does not know as its raw token", () => {
    expect(stopLaneLabel("disk_free")).toBe("disk_free");
    expect(guardLaneLabel("gpu")).toBe("gpu");
  });

  it("names the pool, and a missing pool is unknown", () => {
    expect(guardLaneLabel("host")).toBe("host");
    expect(guardLaneLabel("wsl")).toBe("WSL");
    expect(guardLaneLabel("threads")).toBe("threads");
    expect(guardLaneLabel(null)).toBe("unknown");
  });
});

describe("counts", () => {
  it("renders null as unknown and a real zero as 0", () => {
    expect(formatStopCount(null)).toBe("unknown");
    expect(formatStopCount(0)).toBe("0");
    expect(formatStopCount(12)).toBe("12");
  });

  it("never renders an unknown session count as zero", () => {
    expect(
      formatSessions(
        row({ session_count_terminal: 3, session_count_live_claude: null })
      )
    ).toBe("3 terminal / unknown claude");
  });
});

describe("observed against limit", () => {
  it("renders memory as bytes free against the floor", () => {
    expect(formatObservedVsLimit(row())).toBe("3.0 GB free / floor 4.0 GB");
  });

  it("renders threads as a count against the ceiling", () => {
    expect(
      formatObservedVsLimit(
        row({ lane: "thread_pressure", observed: 540, limit_value: 512 })
      )
    ).toBe("540 / 512 threads");
  });

  it("is unknown when either side was not recorded", () => {
    expect(formatObservedVsLimit(row({ observed: null }))).toBe("unknown");
    expect(formatObservedVsLimit(row({ limit_value: null }))).toBe("unknown");
  });
});

describe("calibration summary", () => {
  it("reports an empty calibration as none recorded, not as calm", () => {
    expect(calibrationSummary(row())).toEqual({
      effective: "none recorded",
      fleet: "unknown",
    });
  });

  it("lists the distinct recorded sources, sorted", () => {
    expect(
      calibrationSummary(
        row({
          calibration: {
            thread_ceilings: { source: "machine_scaled", warn: 400 },
            floors: { host: { source: "default" }, wsl: { source: "default" } },
          },
        })
      ).effective
    ).toBe("sources: default, machine_scaled");
  });

  it("counts the fields when none carries a source", () => {
    expect(
      calibrationSummary(row({ calibration: { baseline: 12, per_session: 3 } }))
        .effective
    ).toBe("2 fields recorded");
  });

  it("reads the fleet calibration's own typed state", () => {
    expect(
      calibrationSummary(
        row({
          fleet_calibration: {
            state: "unknown",
            reason: "fleet-calibration state source not shipped",
          },
        })
      ).fleet
    ).toBe("unknown");
    expect(
      calibrationSummary(row({ fleet_calibration: { active_trials: 1 } })).fleet
    ).toBe("recorded");
  });
});

describe("omitted fields are unknown, not a crash or a number", () => {
  const omit = (o: Record<string, unknown>) =>
    row(o as Partial<ResourceStopRow>);

  it("renders a missing calibration as none recorded and a missing fleet one as unknown", () => {
    expect(
      calibrationSummary(
        omit({ calibration: undefined, fleet_calibration: undefined })
      )
    ).toEqual({ effective: "none recorded", fleet: "unknown" });
  });

  it("renders a missing observed or limit as unknown, never NaN", () => {
    expect(formatObservedVsLimit(omit({ observed: undefined }))).toBe(
      "unknown"
    );
    expect(formatObservedVsLimit(omit({ limit_value: undefined }))).toBe(
      "unknown"
    );
    expect(formatStopCount(undefined)).toBe("unknown");
  });
});

describe("suppressionNote", () => {
  it("says nothing for zero counts", () => {
    expect(suppressionNote(row())).toBeNull();
  });
  it("shows positive counts", () => {
    expect(
      suppressionNote(row({ suppressed_count: 4, dropped_before: 2 }))
    ).toBe("4 suppressed, 2 dropped before");
  });
  it("keeps an omitted count unknown, never 0", () => {
    expect(
      suppressionNote(
        row({
          suppressed_count: undefined,
          dropped_before: 0,
        } as unknown as Partial<ResourceStopRow>)
      )
    ).toBe("suppressed: unknown");
  });
});
