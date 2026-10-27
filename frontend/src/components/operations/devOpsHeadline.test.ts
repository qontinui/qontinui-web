/**
 * The Dev Ops headline figures (plan `2026-10-23-console-presentation-spaces`
 * Phase 7) — every arm of every figure, enumerated rather than sampled:
 * loading, a failed latest poll, an answered empty read, the mixed fleet, and
 * each figure's own partial-knowledge case. The rule each `unknown` assertion
 * holds is the same one: a figure whose read did not answer is UNKNOWN with
 * its reason, and never a zero.
 */

import { describe, expect, it } from "vitest";
import type { HeadlineValue } from "@/components/presentation";
import type { FleetHealthDevice } from "@/lib/api/operations/coordFleet";
import type { CiRunnerMirrorRead, CoordCiRunnerRow } from "./ciRunnerMirror";
import {
  ciRunnersReadyFigure,
  latestInstant,
  machinesHealthyFigure,
  workspacesInUseFigure,
} from "./devOpsHeadline";
import type {
  WorktreeSlotDevice,
  WorktreeSlotsResponse,
} from "./useFleetWorktreeSlots";

const T = 1_760_000_000_000;

function known(value: HeadlineValue) {
  if (value.state !== "known") {
    throw new Error(`expected a known figure, got unknown: ${value.reason}`);
  }
  return value;
}

function unknown(value: HeadlineValue) {
  if (value.state !== "unknown") {
    throw new Error(`expected an unknown figure, got ${value.value}`);
  }
  return value;
}

const device = (id: string, state?: string): FleetHealthDevice =>
  ({ device_id: id, hostname: `host-${id}`, state }) as FleetHealthDevice;

describe("machinesHealthyFigure", () => {
  const base = { devices: [], answered: true, error: null, asOfMs: T };

  it("is UNKNOWN before the first answer — never 0", () => {
    const v = unknown(
      machinesHealthyFigure({ ...base, answered: false, asOfMs: null })
    );
    expect(v.reason).toBe("Machine health has not been read yet.");
  });

  it("is UNKNOWN when the LATEST poll failed, even with an earlier answer kept", () => {
    const v = unknown(
      machinesHealthyFigure({
        ...base,
        devices: [device("a", "healthy")],
        error: "HTTP 503",
      })
    );
    expect(v.reason).toMatch(/latest read of machine health failed/);
  });

  it("states a measured empty fleet as 0, with what it measured", () => {
    const v = known(machinesHealthyFigure(base));
    expect(v.value).toBe("0");
    expect(v.detail).toMatch(/lists no machines/);
    expect(v.asOf).toBe(T);
  });

  it("counts coord's own healthy verdict and names every other state", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        devices: [
          device("a", "healthy"),
          device("b", "healthy"),
          device("c", "degraded"),
          device("d", "partitioned"),
          device("e", "abandoned"),
          device("f", "stale"),
          device("g"),
          device("h", "something-new"),
        ],
      })
    );
    expect(v.value).toBe("2 of 8");
    expect(v.detail).toBe(
      "Healthy by the coordination service's own check; 2 unreachable, 1 degraded, 1 with telemetry gone quiet and 2 with no reported state."
    );
  });

  it("says so when every machine is healthy", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        devices: [device("a", "healthy"), device("b", "healthy")],
      })
    );
    expect(v.value).toBe("2 of 2");
    expect(v.detail).toMatch(/Every machine .* reports healthy/);
  });
});

function slotDevice(
  id: string,
  active: number,
  max: number,
  censusRows: number
): WorktreeSlotDevice {
  return {
    device_id: id,
    hostname: `host-${id}`,
    active_worktrees: active,
    max_worktrees: max,
    census_recent_rows: censusRows,
    occupants: { shown: 0, total: 0, truncated: false, rows: [] },
  };
}

function slots(
  devices: WorktreeSlotDevice[],
  truncated = false
): WorktreeSlotsResponse {
  return {
    tenant_id: "t",
    device_count: devices.length,
    truncated,
    device_cap: 100,
    census_window_secs: 900,
    devices,
  };
}

describe("workspacesInUseFigure", () => {
  const spine = [{ device_id: "a" }, { device_id: "b" }];

  it("is UNKNOWN before the first answer", () => {
    const v = unknown(
      workspacesInUseFigure({
        devices: spine,
        data: null,
        error: null,
        fetchedAtMs: null,
      })
    );
    expect(v.reason).toBe("Agent workspaces have not been read yet.");
  });

  it("is UNKNOWN when the latest poll failed — never the kept number", () => {
    const v = unknown(
      workspacesInUseFigure({
        devices: spine,
        data: slots([slotDevice("a", 3, 8, 2)]),
        error: "coord abandoned the read",
        fetchedAtMs: T,
      })
    );
    expect(v.reason).toMatch(/latest read of agent workspaces failed/);
  });

  it("is UNKNOWN when no machine reports slots at all", () => {
    const v = unknown(
      workspacesInUseFigure({
        devices: [],
        data: slots([]),
        error: null,
        fetchedAtMs: T,
      })
    );
    expect(v.reason).toBe("No machine reports agent workspace slots yet.");
  });

  it("is UNKNOWN — not 0 of 16 — when no machine's count is corroborated live", () => {
    const v = unknown(
      workspacesInUseFigure({
        devices: spine,
        data: slots([slotDevice("a", 0, 8, 0), slotDevice("b", 0, 8, 0)]),
        error: null,
        fetchedAtMs: T,
      })
    );
    expect(v.reason).toBe(
      "None of the 2 machines has a slot count confirmed as live, so capacity in use cannot be stated."
    );
  });

  it("sums only the live counts, and names the machines left out", () => {
    const v = known(
      workspacesInUseFigure({
        // c is on the spine but not on the slot read; b has no census.
        devices: [...spine, { device_id: "c" }],
        data: slots([slotDevice("a", 3, 8, 2), slotDevice("b", 5, 8, 0)]),
        error: null,
        fetchedAtMs: T,
      })
    );
    expect(v.value).toBe("3 of 8");
    expect(v.detail).toBe(
      "Agent workspaces in use across 1 machine; 2 machines not counted, with no live slot count."
    );
    expect(v.asOf).toBe(T);
  });

  it("adds every live machine, and says when coord cut the read", () => {
    const v = known(
      workspacesInUseFigure({
        devices: spine,
        data: slots([slotDevice("a", 3, 8, 2), slotDevice("b", 8, 8, 1)], true),
        error: null,
        fetchedAtMs: T,
      })
    );
    expect(v.value).toBe("11 of 16");
    expect(v.detail).toBe(
      "Agent workspaces in use across 2 machines; some machines were left out of the read."
    );
  });
});

function mirrorRow(
  host: string,
  status: string | null,
  labels: string[] = ["self-hosted", "qontinui"]
): CoordCiRunnerRow {
  return {
    device_id: `dev-${host}`,
    hostname: host,
    ci_runner_status: status,
    ci_runner_labels: labels,
    last_seen_at: null,
  };
}

function mirror(
  rows: CoordCiRunnerRow[],
  over: Partial<Extract<CiRunnerMirrorRead, { state: "ok" }>> = {}
): CiRunnerMirrorRead {
  return {
    state: "ok",
    byHostname: new Map(rows.map((r) => [r.hostname, r])),
    asOf: "2026-10-23T12:00:00Z",
    windowSecs: 180,
    unplaceableRows: 0,
    shadowedRows: 0,
    ...over,
  };
}

describe("ciRunnersReadyFigure", () => {
  it("is UNKNOWN while loading and when the mirror is unavailable", () => {
    expect(unknown(ciRunnersReadyFigure({ state: "loading" })).reason).toBe(
      "The CI runner list has not been read yet."
    );
    expect(
      unknown(
        ciRunnersReadyFigure({ state: "unavailable", reason: "HTTP 500" })
      ).reason
    ).toMatch(/could not be read/);
  });

  it("states a measured empty roster as 0", () => {
    const v = known(ciRunnersReadyFigure(mirror([])));
    expect(v.value).toBe("0");
    expect(v.detail).toBe("No self-hosted CI runners are registered.");
    expect(v.asOf).toBe("2026-10-23T12:00:00Z");
  });

  it("is UNKNOWN — never 0 — when the roster lists no runner because the ones it returned could not be placed", () => {
    // Coord answered with registrations, and the console could place none
    // of them: those are runners nobody counted, not an empty fleet.
    for (const over of [{ unplaceableRows: 2 }, { shadowedRows: 1 }]) {
      const v = unknown(ciRunnersReadyFigure(mirror([], over)));
      expect(v.reason).toMatch(/could not place/);
    }
  });

  it("counts a runner ready only when it is idle, online AND carries both routing labels", () => {
    const v = known(
      ciRunnersReadyFigure(
        mirror([
          mirrorRow("idle", "idle"),
          mirrorRow("busy", "busy"),
          mirrorRow("offline", "offline"),
          mirrorRow("unrouted", "idle", ["self-hosted"]),
          mirrorRow("silent", null),
          mirrorRow("odd", "rebooting"),
        ])
      )
    );
    expect(v.value).toBe("1 of 6");
    // A partition: the one ready runner and every other one, each named once.
    expect(v.detail).toBe(
      "Idle and able to take a job now; 1 running a job, 1 offline, 1 runner online but not receiving fleet jobs and 2 with status unknown."
    );
  });

  it("does not count a runner that is busy with a job as ready", () => {
    const v = known(
      ciRunnersReadyFigure(
        mirror([mirrorRow("a", "busy"), mirrorRow("b", "busy")])
      )
    );
    expect(v.value).toBe("0 of 2");
    expect(v.detail).toBe("Idle and able to take a job now; 2 running a job.");
  });

  it("says when every runner is ready, and when the roster is incomplete", () => {
    expect(
      known(ciRunnersReadyFigure(mirror([mirrorRow("a", "idle")]))).detail
    ).toBe("Every registered runner is idle and can take a job.");
    const partial = known(
      ciRunnersReadyFigure(
        mirror([mirrorRow("a", "idle")], { unplaceableRows: 1 })
      )
    );
    expect(partial.detail).toMatch(/roster is incomplete/);
  });

  it("dates the figure by coord's own as_of, and leaves it null when coord sent none", () => {
    expect(
      known(ciRunnersReadyFigure(mirror([mirrorRow("a", "idle")]))).asOf
    ).toBe("2026-10-23T12:00:00Z");
    expect(
      known(
        ciRunnersReadyFigure(mirror([mirrorRow("a", "idle")], { asOf: null }))
      ).asOf
    ).toBeNull();
  });
});

describe("latestInstant — the as-of of a read that dates its rows", () => {
  it("is the newest parseable instant, as ISO-8601", () => {
    expect(
      latestInstant([
        "2026-10-23T12:00:00Z",
        "2026-10-23T12:05:00Z",
        "2026-10-23T11:00:00Z",
      ])
    ).toBe("2026-10-23T12:05:00.000Z");
  });

  it("skips what cannot be dated, and is UNKNOWN (null) — never now — when nothing can", () => {
    expect(latestInstant([null, "not a time", "2026-10-23T12:00:00Z"])).toBe(
      "2026-10-23T12:00:00.000Z"
    );
    expect(latestInstant([null, undefined, "", "garbage"])).toBeNull();
    expect(latestInstant([])).toBeNull();
  });
});
