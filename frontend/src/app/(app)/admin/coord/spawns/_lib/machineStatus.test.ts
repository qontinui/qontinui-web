/**
 * The Machines section's derivation — every arm, without a DOM: drain,
 * dispatch role, in flight against ceiling (UNKNOWN by a named missing door)
 * and sessions open now (coord's count, or UNKNOWN saying why — never 0), in
 * operator mode and in presentation mode.
 */

import { distinguishDevices } from "./deviceDistinction";
import { describe, expect, it } from "vitest";
import { parseDispatchRoles } from "@/components/operations/fleetDispatchRoles";
import { parseFleetDrain } from "@/components/operations/fleetDrain";
import { AS_OF, DEVICE_A, DEVICE_B, ROSTER } from "../__fixtures__/coordSpawns";
import { ROLES_KNOWN } from "../__fixtures__/spawnsRoutes";
import { concurrencyBody, drainBody } from "../__fixtures__/spawnPaths";
import {
  IN_FLIGHT_UNKNOWN,
  machineListStale,
  machineListUnknown,
  machineStatusLines,
  type MachineStatusInput,
} from "./machineStatus";

const NOW = Date.parse(AS_OF);

function input(
  overrides: Partial<MachineStatusInput> = {}
): MachineStatusInput {
  return {
    devices: ROSTER.devices,
    devicesError: null,
    drain: parseFleetDrain(drainBody(NOW)),
    roles: parseDispatchRoles(ROLES_KNOWN),
    sessions: { data: concurrencyBody(), issue: null },
    sessionsWindowLabel: "the last 24 hours",
    nowMs: NOW,
    presenting: false,
    ...overrides,
  };
}

function lineOf(lines: ReturnType<typeof machineStatusLines>, id: string) {
  const line = lines?.find((l) => l.key === id);
  if (!line) throw new Error(`no line ${id}`);
  return line;
}

describe("machineStatusLines", () => {
  it("gives every roster machine its drain, role, in-flight and sessions", () => {
    const lines = machineStatusLines(input());
    expect(lines?.map((l) => l.key)).toEqual([DEVICE_A, DEVICE_B]);
    const a = lineOf(lines, DEVICE_A);
    expect(a.identity).toEqual({ deviceId: DEVICE_A, hostname: "msi-wsl" });
    expect(a.drain).toMatchObject({
      state: "not_drained",
      text: "taking new work",
    });
    expect(a.role).toMatchObject({
      state: "workhorse",
      text: "Workhorse",
      unknown: false,
    });
    expect(a.sessions).toMatchObject({
      state: "known",
      text: "3 open now",
      unknown: false,
    });
    const b = lineOf(lines, DEVICE_B);
    expect(b.drain.state).toBe("drained");
    expect(b.drain.text).toMatch(/^out of service — back in /);
    expect(b.drain.title).toContain("rebuilding the box");
    expect(b.drain.title).toContain("operator@example.com");
    expect(b.role.text).toBe("Bench");
  });

  it("says in flight against ceiling is UNKNOWN on every line, naming the door no console reads", () => {
    for (const line of machineStatusLines(input()) ?? []) {
      expect(line.inFlight.unknown).toBe(true);
      expect(line.inFlight.text).toBe("UNKNOWN");
      expect(line.inFlight.title).toContain("/coord/agent-fixer-arm-readiness");
    }
    expect(IN_FLIGHT_UNKNOWN.operator).toContain("admission");
  });

  it("never reads a machine the run record does not list as zero sessions", () => {
    const b = lineOf(machineStatusLines(input()), DEVICE_B);
    expect(b.sessions.unknown).toBe(true);
    expect(b.sessions.text).toBe("UNKNOWN");
    expect(b.sessions.title).toContain(
      "lists no run on this machine in the last 24 hours"
    );
    expect(b.sessions.title).toContain("not none");
  });

  it("reads a silent machine's open runs as UNKNOWN", () => {
    const body = concurrencyBody();
    body.devices[0]!.heartbeat_age_seconds = 3 * 3600;
    const a = lineOf(
      machineStatusLines(input({ sessions: { data: body, issue: null } })),
      DEVICE_A
    );
    expect(a.sessions.unknown).toBe(true);
    expect(a.sessions.title).toContain("no heartbeat");
  });

  it("says why the session count is unknown when the run record could not be read", () => {
    const lines = machineStatusLines(
      input({ sessions: { data: null, issue: { kind: "route_unavailable" } } })
    );
    const a = lineOf(lines, DEVICE_A);
    expect(a.sessions.text).toBe("UNKNOWN");
    expect(a.sessions.title).toContain(
      "Coord does not serve the session run record yet"
    );
  });

  it("keeps the last good count of a failed refresh, labelled stale", () => {
    const lines = machineStatusLines(
      input({
        sessions: {
          data: concurrencyBody(),
          issue: { kind: "error", message: "HTTP 502" },
        },
      })
    );
    const a = lineOf(lines, DEVICE_A);
    expect(a.sessions.text).toBe("3 open now (stale)");
    expect(a.sessions.unknown).toBe(true);
    expect(a.sessions.title).toContain("last good read");
  });

  it("reads a drain and a role it could not read as UNKNOWN with the reason", () => {
    const lines = machineStatusLines(
      input({
        drain: { state: "unknown", reason: "GET /fleet/drain answered 404" },
        roles: { state: "unknown", reason: "HTTP 500 from the role read" },
      })
    );
    const a = lineOf(lines, DEVICE_A);
    expect(a.drain).toMatchObject({ state: "unknown", text: "drain UNKNOWN" });
    expect(a.drain.title).toContain("404");
    expect(a.role).toMatchObject({ state: "unknown", text: "role UNKNOWN" });
    expect(a.role.title).toContain("HTTP 500");
  });

  it("reads a machine the role read does not list as role UNKNOWN", () => {
    const roles = parseDispatchRoles({ state: "known", machines: [] });
    const a = lineOf(machineStatusLines(input({ roles })), DEVICE_A);
    expect(a.role.state).toBe("unknown");
    expect(a.role.title).toContain("does not list this machine");
  });

  it("says a drain that ran out is over", () => {
    const expiredAt = NOW - 60_000;
    const drain = parseFleetDrain({
      as_of: AS_OF,
      drained: {
        [DEVICE_B]: { until: new Date(expiredAt).toISOString(), reason: "x" },
      },
    });
    const b = lineOf(machineStatusLines(input({ drain })), DEVICE_B);
    expect(b.drain.state).toBe("expired");
    expect(b.drain.text).toBe("drain expired — taking new work");
  });

  it("shows no list, and says why, before the roster is read", () => {
    expect(machineStatusLines(input({ devices: null }))).toBeNull();
    expect(
      machineListUnknown({
        devices: null,
        devicesError: null,
        presenting: false,
      })
    ).toBe("Reading the fleet roster…");
    expect(
      machineListUnknown({
        devices: null,
        devicesError: "GET /fleet/health failed: 502",
        presenting: false,
      })
    ).toContain("unknown — not none");
  });
});

describe("a failed refresh of the roster", () => {
  const failure = "GET /fleet/health failed: 502 at http://10.0.0.5:8080";

  it("keeps the last good list, says it is stale above it, and marks every line", () => {
    const stale = input({ devicesError: failure });
    const lines = machineStatusLines(stale);
    expect(lines?.map((l) => l.key)).toEqual([DEVICE_A, DEVICE_B]);
    expect(lines?.every((l) => l.stale)).toBe(true);
    expect(machineListStale(stale)).toBe(
      `The latest refresh of the fleet roster failed (${failure}), so this list is from the last good read: a machine added or removed since then is not reflected.`
    );
  });

  it("says nothing while the list is current, or when there is no list to be stale", () => {
    const current = input();
    expect(machineStatusLines(current)?.some((l) => l.stale)).toBe(false);
    expect(machineListStale(current)).toBeNull();
    expect(
      machineListStale(input({ devices: null, devicesError: failure }))
    ).toBeNull();
  });

  it("withholds the failure's own text while presenting", () => {
    const note = machineListStale(
      input({ devicesError: failure, presenting: true })
    );
    expect(note).toContain("this list is from the last good read");
    expect(note).not.toContain("10.0.0.5");
    expect(note).not.toContain("/fleet/health");
  });
});

describe("in presentation mode", () => {
  it("says a silent machine's unknown count without the session-load page's own words", () => {
    const sessions = {
      issue: null,
      data: concurrencyBody({
        devices: [
          {
            ...concurrencyBody().devices[0]!,
            heartbeat_age_seconds: null,
            open_now: null,
          },
        ],
      }),
    };
    const operator = lineOf(
      machineStatusLines(input({ sessions })),
      DEVICE_A
    ).sessions;
    expect(operator.title).toContain("coord has no heartbeat");
    const presented = lineOf(
      machineStatusLines(input({ sessions, presenting: true })),
      DEVICE_A
    ).sessions;
    expect(presented.text).toBe("UNKNOWN");
    expect(presented.title).toBe(
      "This machine has not reported recently, so how many sessions it has open now is unknown."
    );
  });

  it("carries no drain reason, actor or failure text", () => {
    const lines = machineStatusLines(
      input({
        presenting: true,
        sessions: {
          data: null,
          issue: { kind: "error", message: "GET /api/v1/x failed: 500" },
        },
        roles: {
          state: "unknown",
          reason: "HTTP 500 from /coord/fleet/dispatch-roles",
        },
      })
    );
    const all = (lines ?? []).flatMap((l) =>
      [l.drain, l.role, l.inFlight, l.sessions].flatMap((c) => [
        c.text,
        c.title ?? "",
      ])
    );
    const joined = all.join("\n");
    for (const hidden of [
      "rebuilding the box",
      "operator@example.com",
      "/api/v1",
      "/coord/",
      "500",
    ]) {
      expect(joined, hidden).not.toContain(hidden);
    }
    expect(joined).toContain(IN_FLIGHT_UNKNOWN.presented);
    expect(
      machineListUnknown({
        devices: null,
        devicesError: "GET /fleet/health failed: 502",
        presenting: true,
      })
    ).not.toContain("502");
  });
});

describe("distinguishDevices — two device lines that would read the same", () => {
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const B = "bbbbbbbb-0000-4000-8000-000000000002";
  const C = "cccccccc-0000-4000-8000-000000000003";
  const ordinals: Record<string, number> = { [A]: 5, [B]: 2, [C]: 9 };

  it("gives the operator each shared name's short device id, and leaves a unique name alone", () => {
    const out = distinguishDevices(
      [
        { deviceId: A, name: "host-1" },
        { deviceId: B, name: "HOST-1" },
        { deviceId: C, name: "host-2" },
      ],
      false,
      (id) => ordinals[id] ?? null
    );
    expect([...out.entries()]).toEqual([
      [A, "aaaaaaaa"],
      [B, "bbbbbbbb"],
    ]);
  });

  it("numbers the devices that share a letter while presenting, by the registry's first-seen order, naming no id", () => {
    const out = distinguishDevices(
      [
        { deviceId: A, name: "Machine A" },
        { deviceId: B, name: "Machine A" },
        { deviceId: C, name: "Machine B" },
      ],
      true,
      (id) => ordinals[id] ?? null
    );
    expect(out.get(B)).toBe("device 1");
    expect(out.get(A)).toBe("device 2");
    expect(out.has(C)).toBe(false);
  });
});
