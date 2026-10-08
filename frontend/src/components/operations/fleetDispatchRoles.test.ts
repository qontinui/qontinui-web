/**
 * Reading rules for machine dispatch roles (plan
 * `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6). Pure, so
 * the honesty properties are pinned without a DOM.
 */

import { describe, expect, it } from "vitest";
import {
  describeRole,
  describeRoleEffect,
  describeRoleWriteError,
  parseDispatchRoles,
  parseLane,
  parseRoleMachine,
  validateRoleForm,
} from "./fleetDispatchRoles";

const DEV = "84c02292-32cb-4983-be85-d00f868b7003";

describe("parseDispatchRoles", () => {
  it("an unrecognised body is UNKNOWN, never an empty fleet", () => {
    expect(parseDispatchRoles({ whatever: 1 }).state).toBe("unknown");
    expect(parseDispatchRoles(null).state).toBe("unknown");
  });

  it("an empty machines list is known-and-empty", () => {
    const read = parseDispatchRoles({ machines: [] });
    expect(read).toEqual({ state: "known", machines: [] });
  });

  it("reads device rows, host rows, and sorts by name", () => {
    const read = parseDispatchRoles({
      machines: [
        { device_id: DEV, name: "msi", dispatch_role: "bench" },
        { ci_host_name: "dell-2020", dispatch_role: "ci_node" },
      ],
    });
    if (read.state !== "known") throw new Error("expected known");
    expect(read.machines.map((m) => m.name)).toEqual(["dell-2020", "msi"]);
    const dell = read.machines[0];
    expect(dell.registered).toBe(false);
    expect(dell.hostOnly).toBe(true);
    expect(dell.key).toBe("host:dell-2020");
    expect(read.machines[1].key).toBe(`device:${DEV}`);
  });
});

describe("parseRoleMachine", () => {
  it("'unassigned' and a missing role are both unassigned (null)", () => {
    expect(
      parseRoleMachine({ device_id: DEV, dispatch_role: "unassigned" })?.role
    ).toBeNull();
    expect(parseRoleMachine({ device_id: DEV })?.role).toBeNull();
  });

  it("an unknown role value is surfaced verbatim, never coerced", () => {
    const m = parseRoleMachine({
      device_id: DEV,
      dispatch_role: "session_host",
    });
    expect(m?.role).toBeNull();
    expect(m?.unrecognisedRole).toBe("session_host");
    expect(describeRole(m!)).toContain("Unrecognised");
  });

  it("no suggestion when coord serves none; object or bare suggestion read", () => {
    expect(parseRoleMachine({ device_id: DEV })?.suggestion).toBeNull();
    expect(
      parseRoleMachine({ device_id: DEV, suggestion: "bench" })?.suggestion
        ?.role
    ).toBe("bench");
    const s = parseRoleMachine({
      device_id: DEV,
      suggestion: { role: "workhorse", mem_total_bytes: 66e9 },
    })?.suggestion;
    expect(s?.role).toBe("workhorse");
    expect(s?.memTotalBytes).toBe(66e9);
  });

  it("a row naming no machine is dropped", () => {
    expect(parseRoleMachine({ dispatch_role: "bench" })).toBeNull();
  });

  it("explicit agent_host overrides the host-row default", () => {
    expect(
      parseRoleMachine({ device_id: DEV, agent_host: false })?.hostOnly
    ).toBe(true);
    expect(parseRoleMachine({ device_id: DEV })?.hostOnly).toBe(false);
  });
});

describe("describeRole", () => {
  it("unassigned names what it behaves as", () => {
    expect(describeRole(parseRoleMachine({ device_id: DEV })!)).toBe(
      "Unassigned — behaves as Workhorse"
    );
  });
  it("a host row with no device is assigned, not yet registered", () => {
    expect(
      describeRole(
        parseRoleMachine({
          ci_host_name: "dell-2024",
          dispatch_role: "ci_node",
        })!
      )
    ).toBe("CI node — assigned, not yet registered");
  });
});

describe("parseLane — role and drain kept apart", () => {
  it("closed_by_role does not claim the drain is clear", () => {
    expect(parseLane("closed_by_role").drain.state).toBe("not_reported");
  });
  it("closed_by_drain carries the hold", () => {
    const l = parseLane({
      state: "closed_by_drain",
      until: "2026-10-09T00:00:00Z",
    });
    expect(l.drain).toEqual({
      state: "held",
      until: "2026-10-09T00:00:00Z",
      reason: null,
    });
  });
  it("an explicit drain object wins over the state string", () => {
    const l = parseLane({
      state: "closed_by_role",
      drain: { until: "2026-10-09T00:00:00Z", reason: "rebuild" },
    });
    expect(l.drain.state).toBe("held");
  });
  it("an unrecognised state is unknown", () => {
    expect(parseLane("weird").drain.state).toBe("unknown");
    expect(parseLane(undefined).served).toBeNull();
  });
});

describe("describeRoleEffect", () => {
  it("names the operator's own example", () => {
    expect(describeRoleEffect("dell-2020", null, "ci_node")).toBe(
      "dell-2020 → CI node: coord will send no sessions here; CI stays open."
    );
  });
  it("bench closes both", () => {
    expect(describeRoleEffect("nomad", "workhorse", "bench")).toBe(
      "nomad → Bench: coord will send no sessions here; coord will send no CI here."
    );
  });
  it("reopening says so", () => {
    expect(describeRoleEffect("msi", "bench", "ci_node")).toBe(
      "msi → CI node: still no sessions; coord may send CI here again."
    );
  });
});

describe("describeRoleWriteError", () => {
  it("last_open_lane under detail is typed, with its lane, and offers Force", () => {
    const r = describeRoleWriteError(
      409,
      JSON.stringify({ detail: { error: "last_open_lane", lane: "agent" } })
    );
    expect(r.kind).toBe("last_open_lane");
    if (r.kind !== "last_open_lane") throw new Error("unreachable");
    expect(r.lane).toBe("agent");
    expect(r.message).toContain("Force");
  });
  it("no_agent_host at the top level is typed", () => {
    const r = describeRoleWriteError(
      422,
      JSON.stringify({ error: "no_agent_host" })
    );
    expect(r.kind).toBe("no_agent_host");
    expect(r.message).not.toContain("{");
  });
  it("a 403 reads as operator-only", () => {
    expect(
      describeRoleWriteError(
        403,
        JSON.stringify({ detail: "not_coord_tenant_admin" })
      ).kind
    ).toBe("not_admin");
  });
  it("a network failure says nothing changed", () => {
    expect(describeRoleWriteError(null, "boom").message).toContain(
      "Nothing was changed"
    );
  });
  it("a 504 says the change may have applied", () => {
    expect(describeRoleWriteError(504, "").message).toContain("MAY");
  });
});

describe("validateRoleForm", () => {
  it("requires a reason", () => {
    expect(validateRoleForm({ reason: "  " })).not.toBeNull();
    expect(validateRoleForm({ reason: "ok" })).toBeNull();
  });
  it("requires a printable host name when assigning by host", () => {
    expect(validateRoleForm({ reason: "ok", ciHostName: "" })).not.toBeNull();
    expect(
      validateRoleForm({ reason: "ok", ciHostName: "dell 2020" })
    ).not.toBeNull();
    expect(
      validateRoleForm({ reason: "ok", ciHostName: "dell-2020" })
    ).toBeNull();
  });
});
