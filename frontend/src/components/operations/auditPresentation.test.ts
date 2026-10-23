/**
 * How the operator audit feed reads in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): which rows are about a
 * machine, and the fixed words the descriptor is built from.
 */

import { describe, expect, it } from "vitest";
import {
  auditActorMachine,
  auditAreaWord,
  auditListCount,
  auditListValues,
  auditResourceKindWord,
  auditResourceMachine,
  indexDevices,
} from "./auditPresentation";
import type { AuditRow } from "./operatorAudit";

const DEV = "a1a1a1a1-0000-4000-8000-00000000000a";
const byId = indexDevices([
  { device_id: DEV.toUpperCase(), hostname: "host-a" },
  { device_id: "b2b2b2b2-0000-4000-8000-00000000000b" },
]);

function row(over: Partial<AuditRow>): AuditRow {
  return {
    audit_id: "x",
    operator_id: "0f0f0f0f-0000-4000-8000-0000000000ff",
    action: "fleet.drain.set",
    resource_kind: null,
    resource_key: null,
    metadata: {},
    occurred_at: "2026-10-23T12:00:00Z",
    ...over,
  };
}

describe("auditResourceMachine", () => {
  it("recognises a resource key that is a fleet device, case-insensitively", () => {
    expect(auditResourceMachine(row({ resource_key: DEV }), byId)).toEqual({
      deviceId: DEV.toUpperCase(),
      hostname: "host-a",
    });
  });

  it("recognises a promoted metadata.device_id when the key is something else", () => {
    expect(
      auditResourceMachine(
        row({ resource_key: "drain:policy", metadata: { device_id: DEV } }),
        byId
      )
    ).toEqual({ deviceId: DEV.toUpperCase(), hostname: "host-a" });
  });

  it("treats a device-kind row as a machine even when the fleet list lacks it", () => {
    expect(
      auditResourceMachine(
        row({ resource_kind: "coord.devices", resource_key: "ffff-unknown" }),
        byId
      )
    ).toEqual({ deviceId: "ffff-unknown" });
  });

  it("never guesses: anything else is not a machine (and the panel redacts it)", () => {
    expect(
      auditResourceMachine(
        row({
          resource_kind: "coord.pr_events",
          resource_key: "acme-partner/secret-repo#12",
        }),
        byId
      )
    ).toBeNull();
    expect(auditResourceMachine(row({}), byId)).toBeNull();
  });
});

describe("auditActorMachine", () => {
  it("aliases an actor that is one of the fleet's devices", () => {
    expect(auditActorMachine(row({ operator_id: DEV }), byId)).toEqual({
      deviceId: DEV.toUpperCase(),
      hostname: "host-a",
    });
  });

  it("is null for a person (whose id the panel withholds) or no actor", () => {
    expect(auditActorMachine(row({}), byId)).toBeNull();
    expect(auditActorMachine(row({ operator_id: null }), byId)).toBeNull();
  });
});

describe("the descriptor's fixed words", () => {
  it("names resource kinds in the reader's words, never the table name", () => {
    expect(auditResourceKindWord("coord.fleet_runtime_policy")).toBe(
      "Fleet setting"
    );
    expect(auditResourceKindWord("coord.pr_events")).toBe("Pull request");
    expect(auditResourceKindWord("coord.devices")).toBe("Machine");
    expect(auditResourceKindWord("http.route")).toBe("Access check");
    expect(auditResourceKindWord("coord.something_new")).toBe("Resource");
    expect(auditResourceKindWord(null)).toBe("Resource");
  });

  it("names the action family by its prefix, and nothing it does not know", () => {
    expect(auditAreaWord("fleet_policy.upsert")).toBe("fleet policy");
    expect(auditAreaWord("fleet.drain.set")).toBe("fleet");
    expect(auditAreaWord("pr_merge.kill_switch")).toBe("merge train");
    expect(auditAreaWord("something.else")).toBeNull();
  });
});

describe("promoted list values", () => {
  it("counts and reads a list key off the raw metadata, and is null/empty otherwise", () => {
    const r = row({ metadata: { affected_tenant_ids: ["t1", "t2", "t3"] } });
    expect(auditListCount(r, "affected_tenant_ids")).toBe(3);
    expect(auditListValues(r, "affected_tenant_ids")).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    expect(auditListCount(r, "affected_repos")).toBeNull();
    expect(auditListValues(row({ metadata: null }), "affected_repos")).toEqual(
      []
    );
  });
});
