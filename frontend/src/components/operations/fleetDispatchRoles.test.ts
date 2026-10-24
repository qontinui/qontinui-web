/**
 * Reading rules for machine dispatch roles (plan
 * `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6). Pure, so
 * the honesty properties are pinned without a DOM.
 */

import { describe, expect, it } from "vitest";
import {
  describeCapacity,
  describeEffectNotApplied,
  describeLiveSessions,
  describeRole,
  describeRoleEffect,
  describeRoleWriteError,
  parseDispatchRoles,
  parseEffectsNotApplied,
  parseLane,
  parseRoleMachine,
  validateRoleForm,
} from "./fleetDispatchRoles";

const DEV = "84c02292-32cb-4983-be85-d00f868b7003";

function machine(over: Record<string, unknown> = {}) {
  return {
    kind: "workstation",
    machine_key: `device:${DEV}`,
    device_id: DEV,
    ci_host_name: null,
    name: "msi",
    registration: "registered",
    role: null,
    suggestion: null,
    lanes: {
      agent: { effective: "open", role: "open", drain: { state: "none" } },
      ci: { effective: "open", role: "open", drain: { state: "none" } },
    },
    pre_change_sessions: { state: "not_applicable" },
    ...over,
  };
}

const roleRow = (dispatch_role: string) => ({
  dispatch_role,
  reason: "why",
  version: 2,
  updated_by: "op@example.com",
  updated_at: "2026-10-08T10:00:00Z",
});

describe("parseDispatchRoles", () => {
  it("an unrecognised body is UNKNOWN, never an empty fleet", () => {
    expect(parseDispatchRoles({ whatever: 1 }).state).toBe("unknown");
    expect(parseDispatchRoles(null).state).toBe("unknown");
    expect(parseDispatchRoles({ state: "known", machines: null }).state).toBe(
      "unknown"
    );
  });

  it("coord's own unknown carries its detail", () => {
    const read = parseDispatchRoles({
      state: "unknown",
      machines: null,
      detail: "census read failed",
    });
    expect(read.state).toBe("unknown");
    if (read.state !== "unknown") throw new Error("unreachable");
    expect(read.reason).toContain("census read failed");
  });

  it("an empty known list is known-and-empty", () => {
    expect(parseDispatchRoles({ state: "known", machines: [] })).toEqual({
      state: "known",
      machines: [],
      omitted: null,
      unidentifiable: null,
      rosterTruncated: null,
      notice: null,
    });
  });

  it("carries coord's left-out counts rather than dropping them", () => {
    const read = parseDispatchRoles({
      state: "known",
      machines: [],
      older_machines_omitted: 2,
      unidentifiable_ci_runner_rows: 1,
    });
    if (read.state !== "known") throw new Error("expected known");
    expect(read.omitted).toBe(2);
    expect(read.unidentifiable).toBe(1);
  });

  it("carries roster_truncated as served; absent is null", () => {
    const t = parseDispatchRoles({
      state: "known",
      machines: [],
      roster_truncated: true,
    });
    if (t.state !== "known") throw new Error("expected known");
    expect(t.rosterTruncated).toBe(true);
    const f = parseDispatchRoles({
      state: "known",
      machines: [],
      roster_truncated: false,
    });
    if (f.state !== "known") throw new Error("expected known");
    expect(f.rosterTruncated).toBe(false);
    // Not served (or not a bool) is UNKNOWN, never "whole".
    const u = parseDispatchRoles({
      state: "known",
      machines: [],
      roster_truncated: "yes",
    });
    if (u.state !== "known") throw new Error("expected known");
    expect(u.rosterTruncated).toBeNull();
  });

  it("reads workstation and ci_host rows, sorted by name", () => {
    const read = parseDispatchRoles({
      state: "known",
      machines: [
        machine({ role: roleRow("bench") }),
        machine({
          kind: "ci_host",
          machine_key: "host:dell-2020",
          device_id: null,
          ci_host_name: "dell-2020",
          name: "dell-2020",
          registration: "assigned_not_registered",
          role: roleRow("ci_node"),
          // Coord's real shape (qontinui-coord#3015): `not_registered`.
          lanes: {
            agent: {
              effective: "not_registered",
              role: "not_registered",
              drain: { state: "none", total_devices: 0 },
            },
            ci: {
              effective: "not_registered",
              role: "not_registered",
              drain: { state: "none", total_devices: 0 },
            },
          },
        }),
      ],
    });
    if (read.state !== "known") throw new Error("expected known");
    expect(read.machines.map((m) => m.name)).toEqual(["dell-2020", "msi"]);
    const [dell, msi] = read.machines;
    expect(dell.registered).toBe(false);
    expect(dell.hostOnly).toBe(true);
    expect(dell.key).toBe("host:dell-2020");
    // No device rows: every lane reads not_registered.
    expect(dell.lanes?.agent.effective).toBe("not_registered");
    expect(dell.lanes?.ci.role).toBe("not_registered");
    expect(msi.role).toBe("bench");
    expect(msi.version).toBe(2);
    expect(msi.updatedBy).toBe("op@example.com");
  });
});

describe("parseRoleMachine", () => {
  it("an unregistered machine reads not_registered even if a lane says open", () => {
    const m = parseRoleMachine(
      machine({
        registration: "assigned_not_registered",
        role: roleRow("ci_node"),
        lanes: {
          agent: {
            effective: "unknown",
            role: "open",
            drain: { state: "none" },
          },
          ci: { effective: "unknown", role: "open", drain: { state: "none" } },
        },
      })
    );
    expect(m?.lanes?.ci.role).toBe("not_registered");
    expect(m?.lanes?.ci.effective).toBe("not_registered");
  });

  it("a redacted operator email is kept as served", () => {
    const m = parseRoleMachine(
      machine({ role: { ...roleRow("bench"), updated_by: "[redacted]" } })
    );
    expect(m?.updatedBy).toBe("[redacted]");
    expect(
      parseLane({
        effective: "closed_by_drain",
        role: "open",
        drain: { state: "drained", drained_by: "[redacted]" },
      }).drain
    ).toMatchObject({ drainedBy: "[redacted]" });
  });

  it("a null role row is unassigned", () => {
    expect(parseRoleMachine(machine())?.role).toBeNull();
    expect(parseRoleMachine(machine())?.unrecognisedRole).toBeNull();
  });

  it("an unknown role value is surfaced verbatim, never coerced", () => {
    const m = parseRoleMachine(machine({ role: roleRow("session_host") }));
    expect(m?.role).toBeNull();
    expect(m?.unrecognisedRole).toBe("session_host");
    expect(describeRole(m!)).toContain("Unrecognised");
  });

  it("no suggestion when coord serves none; served suggestion read", () => {
    expect(parseRoleMachine(machine())?.suggestion).toBeNull();
    const s = parseRoleMachine(
      machine({
        suggestion: {
          dispatch_role: "workhorse",
          mem_total_bytes: 66e9,
          sample_age_secs: 12,
        },
      })
    )?.suggestion;
    expect(s).toEqual({
      role: "workhorse",
      memTotalBytes: 66e9,
      sampleAgeSecs: 12,
    });
  });

  it("a row naming no machine is dropped", () => {
    expect(
      parseRoleMachine(machine({ device_id: null, ci_host_name: null }))
    ).toBeNull();
  });

  it("unknown and unrecorded pre-change sessions are surfaced, not zero", () => {
    const m = parseRoleMachine(
      machine({ pre_change_sessions: { state: "unknown" } })
    );
    expect(m?.sessionsUnknown).toBe(true);
    expect(
      parseRoleMachine(
        machine({
          pre_change_sessions: {
            state: "known",
            count: 0,
            start_unrecorded: 3,
          },
        })
      )?.sessionsStartUnrecorded
    ).toBe(3);
  });
  it("a workhorse suggestion is not offered for a CI host", () => {
    expect(
      parseRoleMachine(
        machine({
          kind: "ci_host",
          suggestion: { dispatch_role: "workhorse", mem_total_bytes: 66e9 },
        })
      )?.suggestion
    ).toBeNull();
  });
  it("pre-change sessions only when coord says known", () => {
    expect(
      parseRoleMachine(
        machine({ pre_change_sessions: { state: "known", count: 2 } })
      )?.sessionsBeforeChange
    ).toBe(2);
    expect(
      parseRoleMachine(machine({ pre_change_sessions: { state: "unknown" } }))
        ?.sessionsBeforeChange
    ).toBeNull();
  });
});

describe("describeRole", () => {
  it("unassigned names what it behaves as", () => {
    expect(describeRole(parseRoleMachine(machine())!)).toBe(
      "Unassigned — behaves as Workhorse"
    );
  });
  it("an assigned_not_registered host row says so", () => {
    expect(
      describeRole(
        parseRoleMachine(
          machine({
            registration: "assigned_not_registered",
            role: roleRow("ci_node"),
          })
        )!
      )
    ).toBe("CI node — assigned, not yet registered");
  });
});

describe("parseLane — role and drain kept apart", () => {
  it("closed_by_role still carries a separate drain layer", () => {
    const l = parseLane({
      effective: "closed_by_role",
      role: "closed",
      drain: {
        state: "drained",
        until: "2026-10-09T00:00:00Z",
        reason: "rebuild",
        drained_by: "op",
      },
    });
    expect(l.role).toBe("closed");
    expect(l.drain).toEqual({
      state: "drained",
      until: "2026-10-09T00:00:00Z",
      reason: "rebuild",
      drainedBy: "op",
    });
  });
  it("partial drain is read", () => {
    expect(
      parseLane({
        effective: "open",
        role: "open",
        drain: { state: "partial", drained_devices: 2, total_devices: 13 },
      }).drain
    ).toEqual({ state: "partial", drainedDevices: 2, totalDevices: 13 });
  });
  it("not_registered is read, not coerced to unknown", () => {
    const l = parseLane({
      effective: "not_registered",
      role: "not_registered",
      drain: { state: "none", total_devices: 0 },
    });
    expect(l.role).toBe("not_registered");
    expect(l.effective).toBe("not_registered");
  });
  it("anything unrecognised is unknown", () => {
    const l = parseLane({
      effective: "x",
      role: "weird",
      drain: { state: "?" },
    });
    expect(l.role).toBe("unknown");
    expect(l.drain.state).toBe("unknown");
    expect(parseLane(undefined).effective).toBeNull();
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
  it("last_open_lane under detail is typed, with its lanes, and offers Force", () => {
    const r = describeRoleWriteError(
      409,
      JSON.stringify({
        detail: {
          error: "last_open_lane",
          detail: "pass `force: true` to apply it anyway",
          lanes: [
            // A workstation target: both lanes weigh workstations.
            {
              lane: "agent",
              capacity: "workstations",
              remaining: [],
              offline_only: false,
            },
            {
              lane: "ci",
              capacity: "workstations",
              remaining: ["msi"],
              offline_only: true,
            },
          ],
        },
      })
    );
    expect(r.kind).toBe("last_open_lane");
    if (r.kind !== "last_open_lane") throw new Error("unreachable");
    expect(r.lanes).toEqual(["agent", "ci"]);
    expect(r.capacities).toEqual({ agent: "workstations", ci: "workstations" });
    expect(r.message).toContain(
      "no heartbeat-fresh workstation would take agent sessions"
    );
    expect(r.message).toContain("no heartbeat-fresh workstation would take CI");
    // A CI-host target: only CI, weighed over GitHub runner hosts.
    const host = describeRoleWriteError(
      409,
      JSON.stringify({
        error: "last_open_lane",
        lanes: [
          {
            lane: "ci",
            capacity: "github_runner_hosts",
            remaining: [],
            offline_only: false,
          },
        ],
      })
    );
    if (host.kind !== "last_open_lane") throw new Error("unreachable");
    expect(host.message).toContain(
      "no heartbeat-fresh GitHub runner host would take CI"
    );
    expect(r.message).toContain("only offline msi");
    expect(r.message).toContain("Force");
  });
  it("the deployed envelope (dict spliced to top level, repr in message) never shows the repr", () => {
    // `middleware/error_handler.py`: `message = detail.get("message", str(detail))`.
    const r = describeRoleWriteError(
      409,
      JSON.stringify({
        error: "last_open_lane",
        message: "{'error': 'last_open_lane', 'detail': 'x', 'lanes': [...]}",
        detail: "this change would leave your tenant with no machine",
        lanes: [{ lane: "ci", remaining: [], offline_only: false }],
        timestamp: 1,
        path: "/api/v1/operations/fleet/dispatch-role",
      })
    );
    expect(r.kind).toBe("last_open_lane");
    expect(r.message).not.toContain("{'error'");
    const other = describeRoleWriteError(
      400,
      JSON.stringify({
        error: "reason_required",
        message: "{'error': 'reason_required', 'detail': 'a reason is needed'}",
        detail: "a reason is needed",
      })
    );
    expect(other.message).toBe(
      "HTTP 400 — reason_required — a reason is needed"
    );
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
  it("a 403 device_not_in_tenant is not reported as not-an-operator", () => {
    const r = describeRoleWriteError(
      403,
      JSON.stringify({
        error: "device_not_in_tenant",
        message: "{'error': 'device_not_in_tenant'}",
        detail: "no device with this id is bound to your tenant",
      })
    );
    expect(r.kind).toBe("other");
    expect(r.message).toContain("device_not_in_tenant");
  });
  it("a network failure does not claim nothing changed", () => {
    const m = describeRoleWriteError(null, "boom").message;
    expect(m).toContain("may or may not");
    expect(m).not.toContain("Nothing was changed");
  });
  it("a CI host never took sessions, so its effect sentence does not say it stops them", () => {
    expect(describeRoleEffect("dell-2020", null, "ci_node", true)).toBe(
      "dell-2020 → CI node: still no sessions (no workstation runner); CI stays open."
    );
  });
  it("only the proxy's own connect failure says nothing changed on a 502", () => {
    expect(
      describeRoleWriteError(
        502,
        JSON.stringify({
          error: "BAD_GATEWAY",
          message: "coord is not reachable",
        })
      ).message
    ).toContain("Nothing was changed");
    expect(
      describeRoleWriteError(502, "<html>bad gateway</html>").message
    ).toContain("MAY");
  });
  it("tenant_not_resolved is not reported as not-an-operator", () => {
    expect(
      describeRoleWriteError(
        403,
        JSON.stringify({ error: "FORBIDDEN", message: "tenant_not_resolved" })
      ).message
    ).toContain("No coord tenant is selected");
  });
  it("the effect sentence's 'before' follows coord's served role layer", () => {
    // A co-tenant's Bench already closes sessions here.
    expect(
      describeRoleEffect("msi", null, "ci_node", false, {
        agent: "closed",
        ci: "open",
      })
    ).toBe("msi → CI node: still no sessions; CI stays open.");
  });
  it("a 500 may have applied; a 503 schema_pending did not", () => {
    const r500 = describeRoleWriteError(500, JSON.stringify({ error: "x" }));
    expect(r500.kind === "other" && r500.mayHaveApplied).toBe(true);
    const r503 = describeRoleWriteError(
      503,
      JSON.stringify({ error: "schema_pending", detail: "nothing was written" })
    );
    expect(r503.kind === "other" && r503.mayHaveApplied).toBeFalsy();
  });
  it("another tenant's closing role is not promised to reopen", () => {
    expect(
      describeRoleEffect("msi", null, "workhorse", false, {
        agent: "closed",
        ci: "closed",
      })
    ).toBe(
      "msi → Workhorse: sessions stay closed by another tenant's role; CI stay closed by another tenant's role."
    );
  });
  it("an unknown served layer is not presented as open", () => {
    expect(
      describeRoleEffect("msi", null, "workhorse", false, {
        agent: "unknown",
        ci: "open",
      })
    ).toBe(
      "msi → Workhorse: sessions open (current state unknown); CI stays open."
    );
  });
  it("an unassigned machine closed by a co-tenant says so", () => {
    const m = parseRoleMachine(
      machine({
        lanes: {
          agent: {
            effective: "closed_by_role",
            role: "closed",
            drain: { state: "none" },
          },
          ci: { effective: "open", role: "open", drain: { state: "none" } },
        },
      })
    );
    expect(describeRole(m!)).toBe(
      "Unassigned here — another tenant's role closes sessions"
    );
  });
  it("carries coord's read-level notice", () => {
    const read = parseDispatchRoles({
      state: "known",
      machines: [],
      detail: "drain read failed; dispatch is failing CLOSED",
      roles_table: "present",
    });
    if (read.state !== "known") throw new Error("expected known");
    expect(read.notice).toContain("failing CLOSED");
  });
  it("a 504 says the change may have applied", () => {
    expect(describeRoleWriteError(504, "").message).toContain("MAY");
  });
});

describe("capacity, effects and live sessions", () => {
  it("names each capacity; an unknown one verbatim; a missing one generically", () => {
    expect(describeCapacity("workstations")).toBe("workstation");
    expect(describeCapacity("github_runner_hosts")).toBe("GitHub runner host");
    expect(describeCapacity("gpu_boxes")).toContain("gpu_boxes");
    expect(describeCapacity(null)).toBe("machine");
    const r = describeRoleWriteError(
      409,
      JSON.stringify({
        error: "last_open_lane",
        lanes: [{ lane: "ci", remaining: [], offline_only: false }],
      })
    );
    if (r.kind !== "last_open_lane") throw new Error("unreachable");
    expect(r.capacities).toEqual({ ci: null });
    expect(r.message).toContain("no heartbeat-fresh machine would take CI");
  });
  it("reads effects_not_applied, including linked_ci_host_fanout", () => {
    const e = parseEffectsNotApplied([
      { effect: "github_routing_labels", plan_phase: 4, detail: "x" },
      { effect: "linked_ci_host_fanout", plan_phase: 3, detail: "y" },
      { effect: "something_new", plan_phase: 9, detail: "coord words" },
    ]);
    expect(e?.map((x) => x.effect)).toEqual([
      "github_routing_labels",
      "linked_ci_host_fanout",
      "something_new",
    ]);
    expect(describeEffectNotApplied(e![0])).toBe(
      "GitHub routing labels were not changed [plan phase 4] (coord: x)"
    );
    expect(describeEffectNotApplied(e![1])).toContain("linked CI hosts");
    expect(describeEffectNotApplied(e![1])).toContain("(coord: y)");
    expect(describeEffectNotApplied(e![2])).toBe(
      "something_new [plan phase 9] (coord: coord words)"
    );
    expect(
      describeEffectNotApplied({
        effect: "ci_node_config_enabled",
        detail: null,
        planPhase: null,
      })
    ).toBe("the runner's own CI-node switch was not changed");
    expect(parseEffectsNotApplied(undefined)).toBeNull();
    expect(parseEffectsNotApplied([])).toEqual([]);
  });
  it("null live sessions read unknown, never 0", () => {
    expect(describeLiveSessions("unknown")).toBe(
      "live sessions on it: unknown"
    );
    expect(describeLiveSessions(0)).toBe("0 live sessions on it now");
    expect(describeLiveSessions(1)).toBe("1 live session on it now");
    expect(describeLiveSessions(undefined)).toBeNull();
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
    expect(
      validateRoleForm({ reason: "ok", ciHostName: "gh-runner-msi-wsl" })
    ).toContain("msi-wsl");
  });
});
