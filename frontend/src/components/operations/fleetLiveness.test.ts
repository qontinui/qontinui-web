/**
 * `summarizeFleetLiveness` — the Dev Ops Overview's opening verdict.
 *
 * The rules under test are honesty rules, not cosmetics: every one of them
 * exists to stop an absence of signal rendering as an all-clear.
 */

import { describe, expect, it } from "vitest";
import { fleetRosterCut, summarizeFleetLiveness } from "./fleetLiveness";
import type {
  FleetHealthDevice,
  FleetHealthPayload,
} from "@/lib/api/operations/coordFleet";
import type { RosterCompletenessRef } from "@/components/admin/coord/machineHealth";

const device = (id: string, state?: string): FleetHealthDevice => ({
  device_id: id,
  hostname: id,
  state,
});

/** What coord serves beside a roster it read and served whole. */
const whole = (rows: number): RosterCompletenessRef => ({
  excluded: { unbound: 0, bound_to_other_tenant: 0 },
  excluded_error: null,
  truncated: false,
  total: rows,
  degradable_dropped: 0,
  row_cap: { soft: 1000, hard: 10_000 },
});

const summarize = (
  devices: FleetHealthDevice[],
  over: {
    loading?: boolean;
    error?: string | null;
    answered?: boolean;
    /** The rest of the fleet-health body, over a whole roster's fields. */
    body?: Partial<FleetHealthPayload>;
    completeness?: RosterCompletenessRef | null;
  } = {}
) =>
  summarizeFleetLiveness({
    devices,
    completeness:
      over.completeness !== undefined
        ? over.completeness
        : over.body === undefined
          ? whole(devices.length)
          : // A body states its own cut fields; its exclusions read as none withheld.
            {
              excluded: { unbound: 0, bound_to_other_tenant: 0 },
              excluded_error: null,
              ...over.body,
            },
    loading: over.loading ?? false,
    error: over.error ?? null,
    answered: over.answered ?? true,
  });

describe("summarizeFleetLiveness", () => {
  it("is green only when every device reports healthy", () => {
    const s = summarize([device("a", "healthy"), device("b", "healthy")]);
    expect(s.level).toBe("green");
    expect(s.healthy).toBe(2);
    expect(s.unknown).toBe(0);
  });

  it("counts a device with NO reported state as unknown, never healthy", () => {
    const s = summarize([device("a", "healthy"), device("b")]);
    expect(s.unknown).toBe(1);
    expect(s.healthy).toBe(1);
    // Amber, not green: one machine's state is simply not known.
    expect(s.level).toBe("amber");
    expect(s.headline).toContain("no health verdict");
  });

  it("counts an unrecognised state as unknown rather than guessing", () => {
    const s = summarize([device("a", "quiescing")]);
    expect(s.unknown).toBe(1);
    expect(s.healthy).toBe(0);
    expect(s.level).toBe("amber");
  });

  it("goes red only for a live device coord cannot reach", () => {
    const s = summarize([device("a", "healthy"), device("b", "partitioned")]);
    expect(s.level).toBe("red");
    expect(s.unreachable).toBe(1);
    expect(s.headline).toBe("1 of 2 machines unreachable");
    expect(summarize([device("a", "degraded")]).level).toBe("amber");
  });

  it("never turns red for an abandoned machine: coord does not grade it", () => {
    const s = summarize([device("a", "healthy"), device("b", "abandoned")]);
    expect(s.level).toBe("green");
    expect(s.unreachable).toBe(0);
    expect(s.abandoned).toBe(1);
    expect(s.total).toBe(1);
    expect(s.detail).toContain(
      "1 machine coord marked abandoned after a long silence is not counted"
    );
    expect(s.detail).toContain("Every live machine coord lists");
    // Coord has no decommission state: a crash reaches `abandoned` by timer too.
    expect(s.detail).not.toContain("decision");
  });

  // The reading coord served on 2026-11-02 (`GET /coord/fleet/health`), by
  // count: this exact shape used to read "933 of 1000 machines unreachable",
  // permanently red, with coord's row cap standing in for the machine count.
  it("reads a long-lived tenant's cut roster by its live machines, not its rows", () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => device(`h${i}`, "healthy")),
      ...Array.from({ length: 54 }, (_, i) => device(`p${i}`, "partitioned")),
      ...Array.from({ length: 27 }, (_, i) => device(`d${i}`, "degraded")),
      ...Array.from({ length: 879 }, (_, i) => device(`a${i}`, "abandoned")),
    ];
    const s = summarize(rows, {
      completeness: {
        excluded: { unbound: 0, bound_to_other_tenant: 0 },
        excluded_error: null,
        truncated: true,
        total: 4645,
        degradable_dropped: 0,
        row_cap: { soft: 1000, hard: 10_000 },
      },
    });
    expect(s.level).toBe("red");
    expect(s.total).toBe(121);
    expect(s.headline).toBe("54 of 121 machines unreachable");
    expect(s.abandoned).toBe(879);
    expect(s.detail).toContain(
      "879 machines coord marked abandoned after a long silence are not counted"
    );
    expect(s.detail).toContain("lists 1000 rows of 4645");
    expect(s.abandonedIsFloor).toBe(true);
    expect(s.detail).not.toMatch(/\b933\b/);
  });

  it("is amber, naming why, when only abandoned machines are listed", () => {
    const s = summarize([device("a", "abandoned"), device("b", "abandoned")]);
    expect(s.level).toBe("amber");
    expect(s.headline).toBe("No live machines reporting health");
    expect(s.total).toBe(0);
    expect(s.detail).toContain("All 2 machines coord grades are abandoned");
    // Said once: the sentence above already covers the abandoned machines.
    expect(s.detail).not.toContain("not counted");
  });

  it("does not count a placeholder row as a machine, whatever its state", () => {
    const placeholder = {
      ...device("p", "partitioned"),
      dispatch_liveness: "unknown",
    } as FleetHealthDevice;
    const beside = summarize([device("a", "healthy"), placeholder]);
    expect(beside.level).toBe("green");
    expect(beside.total).toBe(1);
    expect(beside.detail).toContain("1 placeholder row");
    const alone = summarize([placeholder]);
    expect(alone.level).toBe("amber");
    expect(alone.headline).toBe("No live machines reporting health");
    expect(alone.detail).toContain("Coord lists no machines");
    expect(alone.detail).toContain("1 placeholder row");
    expect(alone.detail).not.toContain("All 0 machines");
    expect(alone.total).toBe(0);
  });

  it("counts coord's `ci_offline` as itself, never as an unreported state", () => {
    const s = summarize([device("a", "ci_offline")]);
    expect(s.level).toBe("amber");
    expect(s.ciOffline).toBe(1);
    expect(s.unknown).toBe(0);
    expect(s.headline).toBe("1 machine, 1 with CI offline");
  });

  describe("green needs a roster that vouches for every machine", () => {
    const healthy = [device("a", "healthy"), device("b", "healthy")];
    const base = whole(2);

    it("stays green over a cut of only the dead tail, and says it", () => {
      const s = summarize(healthy, {
        completeness: { ...base, truncated: true, total: 9 },
      });
      expect(s.level).toBe("green");
      expect(s.detail).toContain("lists 2 rows of 9");
      expect(s.detail).toContain("Every live machine coord lists");
    });

    it.each([
      [
        "a cut that withheld machines that could degrade",
        { ...base, truncated: true, total: 9, degradable_dropped: 1 },
        "could be degrading",
      ],
      [
        "machines coord withheld",
        { ...base, excluded: { unbound: 1, bound_to_other_tenant: 0 } },
        "withheld 1 machine",
      ],
      [
        "machines coord could not count",
        { ...base, excluded: null, excluded_error: "boom" },
        "could not count",
      ],
      ["a coord that states neither", {}, "does not say"],
    ])("is amber over %s", (_name, completeness, words) => {
      const s = summarize(healthy, { completeness });
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("2 listed machines healthy, any others unknown");
      expect(s.detail).toContain(words);
      expect(s.detail).toContain("Every live machine listed reports healthy.");
    });

    it("never carries coord's own excluded_error text: the strip is presented", () => {
      const s = summarize(healthy, {
        completeness: {
          ...base,
          excluded: null,
          excluded_error: "pool timeout on db-prod-3",
        },
      });
      expect(s.detail).not.toContain("db-prod-3");
    });

    it("never carries excluded_error on a placeholder-only roster either", () => {
      const s = summarize(
        [
          {
            ...device("p", "healthy"),
            dispatch_liveness: "unknown",
          } as FleetHealthDevice,
        ],
        {
          completeness: {
            ...base,
            excluded: null,
            excluded_error: "pool timeout on db-prod-3",
          },
        }
      );
      expect(s.detail).toContain("could not count");
      expect(s.detail).not.toContain("db-prod-3");
    });

    it("says what the count left out on every arm, once", () => {
      const cut = { ...base, truncated: true, total: 9 };
      for (const devices of [
        [device("a", "degraded")],
        [device("a", "stale")],
        [device("a", "ci_offline")],
        [device("a")],
        [device("a", "partitioned")],
      ]) {
        const { detail } = summarize(devices, { completeness: cut });
        expect(detail.split("lists 1 row of 9").length).toBe(2);
      }
      const empty = summarize([], {
        completeness: { ...base, truncated: true, total: 9 },
      });
      expect(empty.detail).toContain("lists 0 rows of 9");
    });

    it("names a binding fault on an empty roster, once, and no known 0", () => {
      const s = summarize([], {
        completeness: {
          ...base,
          excluded: { unbound: 2, bound_to_other_tenant: 0 },
        },
      });
      expect(s.detail).toContain("a binding fault, not an empty fleet");
      expect(s.detail).not.toContain("absence of telemetry");
      expect(s.detail).not.toContain("Coord also withheld");
      expect(s.total).toBeNull();
    });

    it("states no known 0 when nothing listed is live and the roster cannot vouch", () => {
      const withheld = {
        ...base,
        excluded: { unbound: 2, bound_to_other_tenant: 0 },
      };
      const abandoned = summarize([device("a", "abandoned")], {
        completeness: withheld,
      });
      expect(abandoned.total).toBeNull();
      expect(abandoned.detail).toContain("Coord also withheld 2 machines");
      expect(summarize([device("a", "abandoned")]).total).toBe(0);
      const placeholder = summarize(
        [
          {
            ...device("p", "healthy"),
            dispatch_liveness: "unknown",
          } as FleetHealthDevice,
        ],
        { completeness: withheld }
      );
      expect(placeholder.detail).toContain("a binding fault");
      expect(placeholder.detail).not.toContain("Coord also withheld");
    });

    it("keeps a known count over a failed poll, by live machines", () => {
      const s = summarize([device("a", "healthy"), device("b", "abandoned")], {
        error: "HTTP 503",
      });
      expect(s.total).toBe(1);
    });

    it("says what is off in words coord backs, naming no reach it did not measure", () => {
      const ci = summarize([device("a", "ci_offline"), device("b", "healthy")]);
      expect(ci.detail).toContain("GitHub reports its CI runner offline");
      expect(ci.detail).not.toContain("still reaches");
      const twoCi = summarize([
        device("a", "ci_offline"),
        device("b", "ci_offline"),
      ]);
      expect(twoCi.detail).toContain("GitHub reports their CI runners offline");
      const degraded = summarize([
        device("a", "degraded"),
        device("b", "healthy"),
      ]);
      expect(degraded.detail).toContain("recent checks of one failed");
      expect(degraded.detail).not.toContain("still reaches");
      const twoDegraded = summarize([
        device("a", "degraded"),
        device("b", "degraded"),
      ]);
      expect(twoDegraded.detail).toContain("recent checks of them failed");
    });

    it("marks the population as listed and a floor when the roster cannot vouch", () => {
      const completeness = {
        ...base,
        truncated: true,
        total: 9,
        degradable_dropped: 2,
      };
      const red = summarize([device("a", "partitioned")], { completeness });
      expect(red.headline).toBe("1 of 1 listed machine unreachable");
      expect(red.totalIsFloor).toBe(true);
      expect(summarize([device("a", "healthy")]).totalIsFloor).toBe(false);
    });

    it("reconciles with the nav's count, only when the two differ", () => {
      expect(summarize([device("a", "degraded")]).navReconcile).toBeNull();
      expect(
        summarize([device("a", "degraded"), device("b", "abandoned")])
          .navReconcile
      ).toBe(
        "The nav's 2 unhealthy also counts what is not a degradation here: 1 abandoned."
      );
    });

    it("never points the nav's line at words the arm above it did not say", () => {
      const placeholder = {
        ...device("p", "partitioned"),
        dispatch_liveness: "unknown",
      } as FleetHealthDevice;
      const line = summarize([
        device("a", "partitioned"),
        device("b", "unknown"),
        device("c", "abandoned"),
        placeholder,
      ]).navReconcile;
      expect(line).toBe(
        "The nav's 4 unhealthy also counts what is not a degradation here: 1 abandoned, 1 with no health verdict and 1 placeholder row."
      );
      expect(line).not.toContain("named above");
    });

    it("says nothing of the nav over a failed read: it polls on its own", () => {
      expect(
        summarize([device("a", "abandoned")], { error: "HTTP 503" })
          .navReconcile
      ).toBeNull();
    });

    it("says it, not them, of one machine", () => {
      expect(summarize([device("a", "partitioned")]).detail).toContain(
        "stopped reaching it (partitioned)"
      );
    });

    it("joins three parts as a list, and never says coord reported no state of one it did", () => {
      const s = summarize([
        device("a", "degraded"),
        device("b", "stale"),
        device("c", "quarantined"),
      ]);
      expect(s.headline).toBe(
        "3 machines, 1 degraded, 1 with a silent sampler and 1 with no health verdict"
      );
    });

    it("marks the abandoned count as a floor only when rows were cut", () => {
      expect(summarize([device("a", "abandoned")]).abandonedIsFloor).toBe(
        false
      );
      for (const completeness of [
        { ...base, truncated: true, total: 9 },
        { ...base, truncated: true, total: 9, degradable_dropped: 1 },
        { ...base, truncated: true, total: undefined },
      ]) {
        expect(
          summarize([device("a", "abandoned")], { completeness })
            .abandonedIsFloor
        ).toBe(true);
      }
    });

    it("reads a null body as stating nothing, never as whole", () => {
      expect(summarize(healthy, { completeness: null }).level).toBe("amber");
    });
  });

  it("counts coord's `stale` apart from degraded, unknown AND unreachable", () => {
    // Phase 4's fifth DeviceState: the heartbeat is fine, the resource SAMPLER
    // has gone quiet. Three wrong homes, each a different lie —
    //   healthy     hides a publisher that stopped;
    //   unreachable reports a network partition that is not happening;
    //   unknown     says coord had nothing to say, when it made an observation.
    const s = summarize([device("a", "healthy"), device("b", "stale")]);
    expect(s.stale).toBe(1);
    expect(s.unknown).toBe(0);
    expect(s.degraded).toBe(0);
    expect(s.unreachable).toBe(0);
    expect(s.healthy).toBe(1);
    // Amber: not green, and not the red reserved for a device coord cannot
    // reach at all.
    expect(s.level).toBe("amber");
    expect(s.headline).toContain("silent sampler");
    expect(s.detail).toMatch(/not healthy and not unreachable/i);
  });

  it("keeps a stale sampler amber even beside a partitioned device's red", () => {
    // The 2026-08-27 shape is the first, never the second, and the boundary is
    // the whole reason coord added a fifth variant rather than reusing the
    // fourth.
    const s = summarize([device("a", "stale"), device("b", "partitioned")]);
    expect(s.stale).toBe(1);
    expect(s.unreachable).toBe(1);
    expect(s.level).toBe("red");
    // Still counted, not absorbed into the red one.
    expect(summarize([device("a", "stale")]).level).toBe("amber");
  });

  it("renders an EMPTY device list as amber, not as an all-clear", () => {
    const s = summarize([]);
    expect(s.level).toBe("amber");
    expect(s.total).toBe(0);
    expect(s.detail).toContain("not");
    expect(s.headline).toBe("No devices reporting health");
  });

  it("reports total as null, not 0, while the first read is in flight", () => {
    const s = summarize([], { loading: true, answered: false });
    expect(s.total).toBeNull();
    expect(s.headline).toBe("Reading fleet health");
  });

  it("reports total as null, not 0, when the read failed before any answer", () => {
    expect(
      summarize([], { error: "coord unreachable", answered: false }).total
    ).toBeNull();
    // A failure after an answer keeps the last-read count, empty included.
    expect(
      summarize([device("a", "healthy")], { error: "coord unreachable" }).total
    ).toBe(1);
    expect(summarize([], { error: "coord unreachable" }).total).toBe(0);
  });

  it("renders a failed read as amber and says it is about the read", () => {
    // A transport failure is evidence about the network, not about the
    // machines: red would invent an incident, green would hide one.
    const s = summarize([device("a", "healthy")], { error: "502 Bad Gateway" });
    expect(s.level).toBe("amber");
    expect(s.headline).toBe("Fleet health unavailable");
    expect(s.detail).toContain("502 Bad Gateway");
    expect(s.detail).toContain("last read");
  });

  it("distinguishes 'not read yet' from 'nothing to report'", () => {
    const loading = summarize([], { loading: true, answered: false });
    expect(loading.headline).toBe("Reading fleet health");
    expect(loading.headline).not.toBe(summarize([]).headline);
  });

  describe("when coord's row cap cut the roster", () => {
    const healthy = [device("a", "healthy"), device("b", "healthy")];
    const tailOnly = {
      truncated: true,
      total: 4647,
      degradable_dropped: 0,
    };

    it("reads a whole roster exactly as before", () => {
      const s = summarize(healthy, {
        body: { truncated: false, total: 2, degradable_dropped: 0 },
      });
      expect(s.level).toBe("green");
      expect(s.headline).toBe("All 2 machines healthy");
      // "Reports", not "reaches": the strip reads `state`, not `dispatch_liveness`.
      expect(s.detail).toBe("Every machine coord knows about reports healthy.");
      expect(s.rosterNote).toBeNull();
    });

    it("stays green on a cut of abandoned rows, and counts only what it listed", () => {
      const s = summarize(healthy, { body: tailOnly });
      expect(s.level).toBe("green");
      // Every live machine is listed: the cut tail is abandoned or placeholder rows.
      expect(s.headline).toBe("All 2 machines healthy");
      expect(s.detail).toContain(
        "Every live machine coord lists reports healthy"
      );
      expect(s.detail).toContain("lists 2 rows of 4647");
      expect(s.detail).not.toContain("knows about");
      expect(s.total).toBe(2);
      expect(s.rosterNote).toBe("4647 roster rows");
    });

    it("is never green when coord withheld a machine that could be degrading", () => {
      const s = summarize(healthy, {
        body: { truncated: true, total: 10_002, degradable_dropped: 2 },
      });
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("2 listed machines healthy, any others unknown");
      expect(s.detail).toContain("2 machines that could be degrading");
      expect(s.rosterNote).toBe("10002 roster rows, some health unknown");
    });

    it("is never green on a list at the limit from a coord that says nothing", () => {
      const s = summarize(
        Array.from({ length: 1000 }, (_, i) => device(`d${i}`, "healthy")),
        { completeness: {} }
      );
      expect(s.level).toBe("amber");
      expect(s.detail).toContain("1000");
      expect(s.rosterNote).toBe("list may be cut");
    });

    it("keeps red and says what the count leaves out", () => {
      // Partitioned, not abandoned: an abandoned machine turns nothing red.
      const s = summarize(
        [device("a", "partitioned"), device("b", "healthy")],
        {
          body: tailOnly,
        }
      );
      expect(s.level).toBe("red");
      expect(s.headline).toBe("1 of 2 machines unreachable");
      expect(s.detail).toContain("lists 2 rows of 4647");
      expect(s.rosterNote).toBe("4647 roster rows");
    });

    it("reads the shape coord really serves: a capped list of mostly dead rows", () => {
      const rows = Array.from({ length: 1000 }, (_, i) =>
        device(`d${i}`, i < 50 ? "healthy" : i < 67 ? "degraded" : "abandoned")
      );
      const s = summarize(rows, { body: tailOnly });
      // 933 abandoned rows are not 933 unreachable machines: the live ones are 67.
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("67 machines, 17 degraded");
      expect(s.detail).toContain("933 machines coord marked abandoned");
      expect(s.detail).toContain("lists 1000 rows of 4647");
      expect(s.detail).toContain("none of them could be degrading");
    });

    it("says the list was cut when coord gives no figure for it", () => {
      const s = summarize(healthy, { body: { truncated: true } });
      expect(s.level).toBe("amber");
      expect(s.rosterNote).toBe("list cut, some health unknown");
    });

    it("says it about the last read when a later read failed", () => {
      const s = summarize(healthy, { error: "502", body: tailOnly });
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("Fleet health unavailable");
      expect(s.detail).toContain("lists 2 rows of 4647");
    });

    it("reads a body not read yet as whole, so nothing is claimed about it", () => {
      expect(fleetRosterCut(null)).toEqual({ kind: "whole" });
    });
  });
});
