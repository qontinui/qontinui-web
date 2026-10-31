/**
 * The pure half of `/admin/coord/home`'s reads beside coord's project state
 * (`homeSupplements.ts`): every arm that cannot be read is UNKNOWN, never a
 * zero, and the machine predicate is the nav badge's.
 */

import { describe, expect, it } from "vitest";
import type { DevOverview } from "@/services/admin-dev-service";
import {
  degradingCoverage,
  isNotHealthyDevice,
  isRosterBindingFault,
  readEmptyRoster,
  machineVerdict,
  notDegradationsSentence,
  summarizeMachineHealth,
} from "@/components/admin/coord/machineHealth";
import {
  GATES_PAGE_SIZE,
  MACHINES_NOT_READ,
  MACHINES_SOURCE,
  QUEUE_NOT_READ,
  countOpenOperatorGates,
  countPendingOperatorQuestions,
  machineHealthSentence,
  machinesAllHealthy,
  parseMachineHealth,
  queueCountText,
  supplementSource,
  type MachineHealthView,
} from "./homeSupplements";

/** A read roster of machines in the given states (null: no state at all). */
const read = (
  states: Array<string | null>,
  stale = false
): MachineHealthView => ({
  state: "read",
  counts: summarizeMachineHealth(
    states.map((state, i) => ({
      device_id: `d-${i}`,
      ...(state === null ? {} : { state }),
    }))
  ),
  asOf: null,
  stale,
  emptyRoster: null,
});

describe("machine health", () => {
  it("follows coord's project state: four degrading states, abandoned apart, unknown and placeholders without a verdict", () => {
    const c = summarizeMachineHealth([
      { device_id: "h", state: "healthy" },
      { device_id: "d", state: "degraded" },
      { device_id: "s", state: "stale" },
      { device_id: "p", state: "partitioned" },
      { device_id: "c", state: "ci_offline" },
      { device_id: "a", state: "abandoned" },
      { device_id: "u", state: "unknown" },
      { device_id: "n", state: "some_newer_state" },
      { device_id: "ph", state: "partitioned", dispatch_liveness: "unknown" },
      { device_id: "x" },
      { device_id: "e", state: "" },
    ]);
    expect(c).toEqual({
      total: 11,
      notHealthy: 8,
      healthy: 1,
      degrading: 4,
      abandoned: 1,
      noVerdict: 5,
      degradingIds: ["d", "s", "p", "c"],
      degradingWithoutId: 0,
      notDegradations: { abandoned: 1, noVerdict: 3 },
    });
  });

  it("reads each verdict as coord's project state does", () => {
    expect(machineVerdict({ state: "healthy" })).toBe("healthy");
    expect(machineVerdict({ state: "abandoned" })).toBe("abandoned");
    expect(machineVerdict({ state: "unknown" })).toBe("no_verdict");
    expect(machineVerdict({})).toBe("no_verdict");
    expect(
      machineVerdict({ state: "healthy", dispatch_liveness: "unknown" })
    ).toBe("no_verdict");
    expect(
      machineVerdict({
        state: "degraded",
        dispatch_liveness: "outside_dispatch_window",
      })
    ).toBe("degrading");
  });

  it("is the nav's predicate: a stateless machine is not counted unhealthy", () => {
    expect(isNotHealthyDevice({})).toBe(false);
    expect(isNotHealthyDevice({ state: "healthy" })).toBe(false);
    expect(isNotHealthyDevice({ state: "degraded" })).toBe(true);
    expect(isNotHealthyDevice({ state: "abandoned" })).toBe(true);
  });

  it("joins degrading machines to coord's rows by device, so none is counted twice", () => {
    const c = summarizeMachineHealth([
      { device_id: "a", state: "partitioned" },
      { device_id: "b", state: "degraded" },
      { state: "stale" },
    ]);
    expect(c.degradingWithoutId).toBe(1);
    expect(
      degradingCoverage(c, [
        { id: "fleet_health:state:a", subjectKind: "device", subjectId: "a" },
        { id: "repo-row", subjectKind: "repo", subjectId: "b" },
      ])
    ).toEqual({ listed: 1, unlisted: 2 });
    expect(degradingCoverage(c, null)).toEqual({ listed: 0, unlisted: 3 });
  });

  it("reconciles with the nav in one line, by state", () => {
    expect(
      notDegradationsSentence(read(["abandoned", "unknown"]).counts!, {
        seeDevOps: true,
      })
    ).toBe(
      "2 machines not reporting healthy are not degradations: 1 abandoned, 1 with no verdict — see Dev Ops."
    );
    expect(
      notDegradationsSentence(read(["abandoned"]).counts!, {
        seeDevOps: false,
      })
    ).toBe(
      "1 machine not reporting healthy is not a degradation: 1 abandoned."
    );
    // A machine with no state is not one the nav counts.
    expect(
      notDegradationsSentence(read([null, "degraded"]).counts!, {
        seeDevOps: true,
      })
    ).toBeNull();
  });

  it("reads a body with no device list as no reading", () => {
    expect(parseMachineHealth({})).toBeNull();
    expect(parseMachineHealth(null)).toBeNull();
    expect(parseMachineHealth({ devices: [] })?.counts.total).toBe(0);
  });

  it("is calm only when read, current, and no machine is degrading or without a verdict", () => {
    expect(machinesAllHealthy(read(["healthy", "healthy"]))).toBe(true);
    // Abandoned is a decision, not a degradation.
    expect(machinesAllHealthy(read(["healthy", "abandoned"]))).toBe(true);
    expect(machinesAllHealthy(read(["healthy", "degraded"]))).toBe(false);
    expect(machinesAllHealthy(read(["healthy", "unknown"]))).toBe(false);
    expect(machinesAllHealthy(read(["healthy", null]))).toBe(false);
    expect(machinesAllHealthy(read(["healthy"], true))).toBe(false);
    expect(machinesAllHealthy(MACHINES_NOT_READ)).toBe(false);
    expect(
      machinesAllHealthy({ ...MACHINES_NOT_READ, state: "could_not_read" })
    ).toBe(false);
  });

  describe("an empty roster is never calm", () => {
    const empty = (body: Record<string, unknown>): MachineHealthView => {
      const p = parseMachineHealth({ devices: [], ...body });
      return {
        state: "read",
        counts: p!.counts,
        asOf: null,
        stale: false,
        emptyRoster: p!.emptyRoster,
      };
    };

    it("reads coord's exclusion fields into one of four arms", () => {
      expect(readEmptyRoster({ excluded: { unbound: 0 } })).toEqual({
        kind: "none_withheld",
      });
      expect(
        readEmptyRoster({ excluded: { unbound: 2, bound_to_other_tenant: 1 } })
      ).toEqual({ kind: "withheld", unbound: 2, boundToOtherTenant: 1 });
      expect(
        readEmptyRoster({ excluded: null, excluded_error: "pool timed out" })
      ).toEqual({ kind: "withheld_unmeasured", reason: "pool timed out" });
      expect(readEmptyRoster({ excluded: null })).toEqual({
        kind: "withheld_unmeasured",
        reason: null,
      });
      // An error with no count field beside it is still coord saying it
      // could not count: never read as a coord that stated nothing.
      expect(readEmptyRoster({ excluded_error: "pool timed out" })).toEqual({
        kind: "withheld_unmeasured",
        reason: "pool timed out",
      });
      expect(readEmptyRoster({})).toEqual({ kind: "not_stated" });
      expect(
        parseMachineHealth({
          devices: [{ state: "healthy" }],
          excluded: { unbound: 3 },
        })?.emptyRoster
      ).toBeNull();
    });

    it("is a binding fault, UNKNOWN with the reason, when coord withheld devices or could not count them", () => {
      const withheld = empty({ excluded: { unbound: 1 } });
      expect(isRosterBindingFault(withheld.emptyRoster!)).toBe(true);
      expect(machinesAllHealthy(withheld)).toBe(false);
      expect(machineHealthSentence(withheld)).toBe(
        "Coord lists no machines but withheld 1 from its roster (1 with no binding) — a binding fault, not an empty fleet, so machine health is unknown."
      );
      const failed = empty({
        excluded: null,
        excluded_error: "pool timed out",
      });
      expect(isRosterBindingFault(failed.emptyRoster!)).toBe(true);
      expect(machineHealthSentence(failed, { withReason: true })).toBe(
        "Coord lists no machines and could not count the machines it withheld from its roster (pool timed out) — machine health is unknown."
      );
      // Coord's error text is the operator's alone.
      expect(machineHealthSentence(failed)).not.toContain("pool timed out");
    });

    it("says exactly that when nothing was withheld, and still does not call it calm", () => {
      const none = empty({
        excluded: { unbound: 0, bound_to_other_tenant: 0 },
      });
      expect(isRosterBindingFault(none.emptyRoster!)).toBe(false);
      expect(machinesAllHealthy(none)).toBe(false);
      expect(machineHealthSentence(none)).toBe(
        "Coord lists no machines and withheld none from its roster, so there is no machine this view can call healthy."
      );
      expect(machineHealthSentence(empty({}))).toBe(
        "Coord lists no machines and does not say whether it withheld any — machine health is unknown."
      );
    });
  });

  it("words each arm, an unread one as unknown", () => {
    expect(machineHealthSentence(read(["healthy", "healthy"]))).toBe(
      "All 2 machines report healthy."
    );
    expect(machineHealthSentence(read(["healthy", "abandoned"]))).toBe(
      "1 of 2 machines report healthy; none is degrading."
    );
    expect(machineHealthSentence(read(["degraded", "healthy"]))).toBe(
      "1 of 2 machines is in a degrading state."
    );
    expect(
      machineHealthSentence(read(["degraded", "healthy"]), { listed: 1 })
    ).toBe("1 of 2 machines is in a degrading state — listed above.");
    expect(
      machineHealthSentence(read(["degraded", "stale", "unknown", null]), {
        listed: 1,
      })
    ).toBe(
      "2 of 4 machines are in a degrading state — 1 listed above, 1 not in coord's list; 2 have no health verdict, so their health is unknown."
    );
    expect(machineHealthSentence(read(["degraded"]), { listed: 0 })).toBe(
      "1 of 1 machine is in a degrading state — not in coord's list above."
    );
    expect(machineHealthSentence(MACHINES_NOT_READ)).toMatch(/unknown/);
    expect(
      machineHealthSentence({ ...MACHINES_NOT_READ, state: "could_not_read" })
    ).toMatch(/could not be read — unknown/);
  });
});

describe("pending operator questions", () => {
  it("takes coord's total when served", () => {
    expect(
      countPendingOperatorQuestions({ questions: [{}], total: 12 })
    ).toEqual({ count: 12, exact: true });
  });

  it("reads an empty first page as an empty queue — coord omits total with no rows", () => {
    expect(countPendingOperatorQuestions({ questions: [] })).toEqual({
      count: 0,
      exact: true,
    });
  });

  it("uses the page length as exact only when coord says nothing was cut", () => {
    expect(
      countPendingOperatorQuestions({ questions: [{}, {}], truncated: false })
    ).toEqual({ count: 2, exact: true });
    expect(countPendingOperatorQuestions({ questions: [{}, {}] })).toEqual({
      count: 2,
      exact: false,
    });
  });

  it("is no reading for a body with no questions array", () => {
    expect(countPendingOperatorQuestions({})).toBeNull();
    expect(countPendingOperatorQuestions(null)).toBeNull();
    expect(countPendingOperatorQuestions({ total: 3 })).toBeNull();
  });
});

describe("open operator approvals", () => {
  const g = (kind: string, audience: string, verdict = "open") =>
    ({
      verdict,
      clearance_audience: audience,
      predicate: { kind },
    }) as unknown as DevOverview["gates"][number];
  const ov = (
    gates: DevOverview["gates"],
    extra: Partial<DevOverview> = {}
  ): DevOverview =>
    ({
      generated_at: "2026-10-31T00:00:00Z",
      gates,
      counts: { open: gates.length },
      ...extra,
    }) as DevOverview;

  it("counts only open operator_approval gates addressed to the operator", () => {
    expect(
      countOpenOperatorGates(
        ov([
          g("operator_approval", "operator"),
          g("operator_approval", "agent"),
          g("pr_merged", "operator"),
          g("operator_approval", "operator", "cleared"),
        ])
      )
    ).toEqual({ count: 1, exact: true, kept: false });
  });

  it("is a lower bound when the page is full and coord counts more open gates", () => {
    const page = Array.from({ length: GATES_PAGE_SIZE }, () =>
      g("operator_approval", "operator")
    );
    const full = ov(page);
    expect(
      countOpenOperatorGates({ ...full, counts: { ...full.counts, open: 900 } })
    ).toMatchObject({ count: GATES_PAGE_SIZE, exact: false });
    expect(countOpenOperatorGates(full)?.exact).toBe(true);
  });

  it("is no reading for the proxy's cold-start envelope, and a kept one is marked kept", () => {
    expect(
      countOpenOperatorGates(ov([], { coord_error: "unreachable" }))
    ).toBeNull();
    expect(
      countOpenOperatorGates(
        ov([g("operator_approval", "operator")], {
          coord_error: "x",
          coord_reconnecting: true,
        })
      )
    ).toEqual({ count: 1, exact: true, kept: true });
    expect(countOpenOperatorGates(null)).toBeNull();
    expect(
      countOpenOperatorGates({ counts: { open: 0 } } as unknown as DevOverview)
    ).toBeNull();
  });
});

describe("queueCountText", () => {
  it("is UNKNOWN for anything not read, never 0", () => {
    expect(queueCountText(QUEUE_NOT_READ)).toBe("UNKNOWN");
    expect(
      queueCountText({ ...QUEUE_NOT_READ, state: "could_not_read", count: 0 })
    ).toBe("UNKNOWN");
  });

  it("says 'at least' for a lower bound", () => {
    expect(
      queueCountText({
        ...QUEUE_NOT_READ,
        state: "read",
        count: 4,
        exact: true,
      })
    ).toBe("4");
    expect(
      queueCountText({
        ...QUEUE_NOT_READ,
        state: "read",
        count: 4,
        exact: false,
      })
    ).toBe("at least 4");
  });
});

describe("supplementSource — a kept reading names itself", () => {
  it("adds ', last read' to a kept read's source, and nothing to a current one", () => {
    expect(
      supplementSource(MACHINES_SOURCE, { stale: true, asOf: "t" })
    ).toEqual({
      key: MACHINES_SOURCE,
      source: `${MACHINES_SOURCE}, last read`,
      asOf: "t",
    });
    expect(
      supplementSource(MACHINES_SOURCE, { stale: false, asOf: null }).source
    ).toBe(MACHINES_SOURCE);
  });
});
