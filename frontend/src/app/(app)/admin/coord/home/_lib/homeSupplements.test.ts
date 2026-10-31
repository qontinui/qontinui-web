/**
 * The pure half of `/admin/coord/home`'s reads beside coord's project state
 * (`homeSupplements.ts`): every arm that cannot be read is UNKNOWN, never a
 * zero, and the machine predicate is the nav badge's.
 */

import { describe, expect, it } from "vitest";
import type { DevOverview } from "@/services/admin-dev-service";
import {
  isNotHealthyDevice,
  summarizeMachineHealth,
} from "@/components/admin/coord/machineHealth";
import {
  GATES_PAGE_SIZE,
  MACHINES_NOT_READ,
  QUEUE_NOT_READ,
  countOpenOperatorGates,
  countPendingOperatorQuestions,
  machineHealthSentence,
  machinesAllHealthy,
  parseMachineHealth,
  queueCountText,
  type MachineHealthView,
} from "./homeSupplements";

const read = (
  notHealthy: number,
  noState: number,
  total: number,
  stale = false
): MachineHealthView => ({
  state: "read",
  counts: { total, notHealthy, noState },
  asOf: null,
  stale,
});

describe("machine health", () => {
  it("counts every state other than healthy as not healthy, and an absent state as unknown", () => {
    expect(
      summarizeMachineHealth([
        { state: "healthy" },
        { state: "degraded" },
        { state: "stale" },
        { state: "partitioned" },
        { state: "abandoned" },
        { state: "some_newer_state" },
        {},
        { state: "" },
      ])
    ).toEqual({ total: 8, notHealthy: 5, noState: 2 });
  });

  it("is the nav's predicate: a stateless machine is not counted unhealthy", () => {
    expect(isNotHealthyDevice({})).toBe(false);
    expect(isNotHealthyDevice({ state: "healthy" })).toBe(false);
    expect(isNotHealthyDevice({ state: "degraded" })).toBe(true);
  });

  it("reads a body with no device list as no reading", () => {
    expect(parseMachineHealth({})).toBeNull();
    expect(parseMachineHealth(null)).toBeNull();
    expect(parseMachineHealth({ devices: [] })?.counts.total).toBe(0);
  });

  it("is calm only when read, current, and every machine reports healthy", () => {
    expect(machinesAllHealthy(read(0, 0, 3))).toBe(true);
    expect(machinesAllHealthy(read(1, 0, 3))).toBe(false);
    expect(machinesAllHealthy(read(0, 1, 3))).toBe(false);
    expect(machinesAllHealthy(read(0, 0, 3, true))).toBe(false);
    expect(machinesAllHealthy(MACHINES_NOT_READ)).toBe(false);
    expect(
      machinesAllHealthy({ ...MACHINES_NOT_READ, state: "could_not_read" })
    ).toBe(false);
  });

  it("words each arm, an unread one as unknown", () => {
    expect(machineHealthSentence(read(0, 0, 4))).toBe(
      "All 4 machines report healthy."
    );
    expect(machineHealthSentence(read(1, 0, 4))).toBe(
      "1 of 4 machines is in a state other than healthy."
    );
    expect(machineHealthSentence(read(2, 3, 9))).toBe(
      "2 of 9 machines are in a state other than healthy; 3 report no health state, so their health is unknown."
    );
    expect(machineHealthSentence(read(0, 0, 0))).toBe(
      "Coord lists no machines."
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
