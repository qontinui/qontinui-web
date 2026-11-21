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
  /** What coord serves beside a roster it read and served whole. */
  const WHOLE = {
    excluded: { unbound: 0, bound_to_other_tenant: 0 },
    excluded_error: null,
    truncated: false,
    degradable_dropped: 0,
    row_cap: { soft: 1000, hard: 10_000 },
  };
  const base = {
    devices: [],
    completeness: WHOLE,
    answered: true,
    error: null,
    asOfMs: T,
  };

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
    expect(v.value).toBe("2 of 7");
    expect(v.detail).toBe(
      "Healthy by the coordination service's own check; 1 unreachable, 1 degraded, 1 with telemetry gone quiet and 2 with no health verdict. 1 machine the coordination service marked abandoned after a long silence is not counted."
    );
  });

  // The reading coord served on 2026-11-02 (`GET /coord/fleet/health`), by
  // count: this exact shape used to read "40 of 1000", coord's row cap standing
  // in for the machine count, with the abandoned machines as "unreachable".
  it("counts a long-lived tenant's cut roster by its live machines, not its rows", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        completeness: { ...WHOLE, truncated: true, total: 4645 },
        devices: [
          ...Array.from({ length: 40 }, (_, i) => device(`h${i}`, "healthy")),
          ...Array.from({ length: 54 }, (_, i) =>
            device(`p${i}`, "partitioned")
          ),
          ...Array.from({ length: 27 }, (_, i) => device(`d${i}`, "degraded")),
          ...Array.from({ length: 879 }, (_, i) =>
            device(`a${i}`, "abandoned")
          ),
        ],
      })
    );
    expect(v.value).toBe("40 of 121");
    expect(v.detail).toContain("54 unreachable and 27 degraded");
    expect(v.detail).toContain(
      "879 machines the coordination service marked abandoned after a long silence are not counted"
    );
    expect(v.detail).toContain("lists 1000 of 4645 rows");
  });

  it("names coord's `ci_offline`, and leaves a placeholder row out", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        devices: [
          device("a", "healthy"),
          device("b", "ci_offline"),
          {
            ...device("c", "partitioned"),
            dispatch_liveness: "unknown",
          } as FleetHealthDevice,
        ],
      })
    );
    expect(v.value).toBe("1 of 2");
    expect(v.detail).toContain("1 with CI offline");
    expect(v.detail).toContain("1 placeholder row");
    expect(v.detail).not.toContain("unreachable");
  });

  it("states no share when nothing listed is live: 0 of 0 is not one", () => {
    const v = known(
      machinesHealthyFigure({ ...base, devices: [device("a", "abandoned")] })
    );
    expect(v.value).toBe("0");
    expect(v.detail).toContain(
      "The 1 machine the coordination service grades is abandoned"
    );
    expect(v.detail).not.toContain("not counted");
  });

  it.each([
    [
      "coord withheld machines",
      { ...WHOLE, excluded: { unbound: 2, bound_to_other_tenant: 0 } },
      /binding fault/,
    ],
    [
      "coord could not count them",
      { ...WHOLE, excluded: null, excluded_error: "pool timeout on db-prod-3" },
      /could not count/,
    ],
    ["coord states nothing", null, /does not say/],
    [
      "coord cut rows that could be degrading",
      { ...WHOLE, truncated: true, total: 5, degradable_dropped: 3 },
      /may leave out one that is degrading/,
    ],
  ])(
    "is UNKNOWN, never 0, on an empty list when %s",
    (_name, completeness, reason) => {
      const v = unknown(machinesHealthyFigure({ ...base, completeness }));
      expect(v.reason).toMatch(reason);
      expect(v.reason).not.toContain("db-prod-3");
    }
  );

  it("gives no share over a roster that cannot vouch for every machine", () => {
    for (const completeness of [
      { ...WHOLE, truncated: true, total: 9, degradable_dropped: 2 },
      { ...WHOLE, excluded: { unbound: 1, bound_to_other_tenant: 0 } },
      { ...WHOLE, excluded: null, excluded_error: "pool timeout on db-prod-3" },
    ]) {
      const v = unknown(
        machinesHealthyFigure({
          ...base,
          completeness,
          devices: [device("a", "healthy")],
        })
      );
      expect(v.reason).toMatch(/not known right now/);
      expect(v.reason).not.toContain("db-prod-3");
      expect(v.reason).not.toMatch(/\bCoord\b/);
    }
  });

  it.each([
    [
      "coord withheld machines",
      { ...WHOLE, excluded: { unbound: 2, bound_to_other_tenant: 0 } },
      /withheld 2 machines/,
    ],
    [
      "coord could not count them",
      { ...WHOLE, excluded: null, excluded_error: "pool timeout on db-prod-3" },
      /could not count/,
    ],
    ["coord states nothing", null, /does not say/],
    [
      "coord cut rows that could be degrading",
      { ...WHOLE, truncated: true, total: 9, degradable_dropped: 3 },
      /may leave out one that is degrading/,
    ],
  ])(
    "is UNKNOWN, never 0, when nothing listed is live and %s",
    (_name, completeness, reason) => {
      for (const row of [
        device("a", "abandoned"),
        {
          ...device("p", "healthy"),
          dispatch_liveness: "unknown",
        } as FleetHealthDevice,
      ]) {
        const v = unknown(
          machinesHealthyFigure({ ...base, completeness, devices: [row] })
        );
        expect(v.reason).toMatch(reason);
        expect(v.reason).not.toContain("db-prod-3");
      }
    }
  );

  it("says plainly when a whole roster holds only placeholder rows", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        devices: [
          {
            ...device("p", "healthy"),
            dispatch_liveness: "unknown",
          } as FleetHealthDevice,
        ],
      })
    );
    expect(v.value).toBe("0");
    expect(v.detail).toContain("lists no live machine");
    expect(v.detail).toContain("1 placeholder row");
  });

  it("says every LIVE machine when the list leaves abandoned ones out", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        devices: [device("a", "healthy"), device("b", "abandoned")],
      })
    );
    expect(v.value).toBe("1 of 1");
    expect(v.detail).toContain("Every live machine");
    expect(v.detail).not.toContain("knows about");
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

  it("claims no whole fleet when coord cut abandoned rows from the list", () => {
    const devices = [device("a", "healthy"), device("b", "degraded")];
    const v = known(
      machinesHealthyFigure({
        ...base,
        devices,
        completeness: {
          ...WHOLE,
          truncated: true,
          total: 4647,
          degradable_dropped: 0,
        },
      })
    );
    // Every live machine is listed (the cut tail is abandoned or placeholder
    // rows), so the share needs no "listed" qualifier.
    expect(v.value).toBe("1 of 2");
    expect(v.detail).toContain("1 degraded");
    expect(v.detail).toContain("lists 2 of 4647 rows");
    expect(v.detail).not.toMatch(/Every machine/);
    expect(v.detail).not.toMatch(/Coord/);
  });

  it("names who is speaking when a cut leaves no rows at all", () => {
    const v = known(
      machinesHealthyFigure({
        ...base,
        completeness: {
          ...WHOLE,
          truncated: true,
          total: 5,
          degradable_dropped: 0,
        },
      })
    );
    expect(v.value).toBe("0");
    expect(v.detail).toBe(
      "The coordination service lists 0 of 5 rows, and says none of the others could be degrading."
    );
  });

  it("says only that the list may be cut when coord has not said it was", () => {
    const devices = Array.from({ length: 1000 }, (_, i) =>
      device(`d${i}`, "healthy")
    );
    const v = unknown(
      machinesHealthyFigure({ ...base, devices, completeness: {} })
    );
    expect(v.reason).toContain("reached its limit and may be cut off");
    expect(v.reason).not.toContain("was cut off");
  });

  it("gives no figure when coord withheld a machine that could be degrading", () => {
    const devices = [device("a", "healthy")];
    const v = machinesHealthyFigure({
      ...base,
      devices,
      completeness: {
        ...WHOLE,
        truncated: true,
        total: 10_001,
        degradable_dropped: 1,
      },
    });
    expect(v.state).toBe("unknown");
    expect(v.state === "unknown" && v.reason).toContain(
      "may leave out one that is degrading"
    );
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
