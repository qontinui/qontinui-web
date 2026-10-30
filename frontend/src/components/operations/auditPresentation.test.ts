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
  auditResourceRepo,
  auditScope,
  indexDevices,
  VERBATIM_BLAST_KEYS,
  presentedAuditActionLabel,
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

describe("merge-train scopes", () => {
  it("reads coord's two spellings, and nothing else", () => {
    expect(auditScope("tenant")).toEqual({ kind: "tenant" });
    expect(auditScope(" Tenant ")).toEqual({ kind: "tenant" });
    expect(auditScope("repo:acme-partner/secret-repo")).toEqual({
      kind: "repo",
      repo: "acme-partner/secret-repo",
    });
    // Anything else is not guessed at: the panel withholds it.
    expect(auditScope("repo:")).toEqual({ kind: "other" });
    expect(auditScope("fleet")).toEqual({ kind: "other" });
    expect(auditScope(null)).toEqual({ kind: "other" });
  });

  it("redacts a repo-scoped resource key by the repository it names", () => {
    expect(auditResourceRepo("repo:qontinui/qontinui-web")).toBe(
      "qontinui/qontinui-web"
    );
    // Not a scope: the key is its own repository reference.
    expect(auditResourceRepo("acme-partner/secret-repo#12")).toBe(
      "acme-partner/secret-repo#12"
    );
  });
});

describe("the blast-radius values shown as they are", () => {
  it("vouches only for fixed vocabulary, times and numbers", () => {
    for (const key of [
      "drained",
      "until",
      "head_sha",
      "via",
      "domain",
      "level",
      "version",
    ]) {
      expect(VERBATIM_BLAST_KEYS.has(key), key).toBe(true);
    }
    // Every key that names a repository, a scope, a device, a tenant or a
    // person has its own redacting arm — never the verbatim one.
    for (const key of [
      "scope",
      "scope_key",
      "affected_repos",
      "affected_tenant_ids",
      "device_id",
      "target_operator_id",
    ]) {
      expect(VERBATIM_BLAST_KEYS.has(key), key).toBe(false);
    }
  });
});

describe("presentedAuditActionLabel — an action as an outsider reads it", () => {
  it("is the console's label when the action has one", () => {
    expect(presentedAuditActionLabel("fleet.drain.set")).toBe(
      "Drained a machine"
    );
    expect(presentedAuditActionLabel("pr_merge.kill_switch.activate")).toBe(
      "Fired the merge kill switch"
    );
  });

  it("is the action's family in fixed words otherwise — never coord's own id", () => {
    expect(presentedAuditActionLabel("pr_merge.kill_switch")).toBe(
      "A merge train change"
    );
    expect(presentedAuditActionLabel("fleet_policy.something_new")).toBe(
      "A fleet policy change"
    );
    expect(presentedAuditActionLabel("fleet.something_new")).toBe(
      "A fleet change"
    );
    expect(presentedAuditActionLabel("totally.unknown_thing")).toBe(
      "A recorded change"
    );
  });
});
