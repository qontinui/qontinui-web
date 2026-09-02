import { describe, expect, it } from "vitest";
import {
  AUDIT_FILTERS,
  AUTHORIZATION_CHECK_RESOURCE_KIND,
  DEFAULT_AUDIT_FILTER_ID,
  NIL_OPERATOR_ID,
  blastRadiusOf,
  describeAuditAction,
  isAuthorizationCheck,
  isNilOperator,
  parseAuditPayload,
  reasonOf,
  resolveAuditFilter,
  type AuditRow,
} from "./operatorAudit";

/**
 * The operator audit feed's pure half — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 5.
 *
 * The two properties worth failing on are both about NOT reassuring:
 * a row with no computed blast radius must not read like a row that affected
 * nothing, and a failed read must not read like an empty feed.
 */

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    audit_id: "a-1",
    operator_id: "11111111-1111-1111-1111-111111111111",
    action: "fleet.drain.set",
    resource_kind: "coord.fleet_runtime_policy",
    resource_key: "drain:22222222-2222-2222-2222-222222222222",
    metadata: {},
    occurred_at: "2026-08-31T12:00:00Z",
    ...overrides,
  };
}

describe("filters", () => {
  it("defaults to the fleet actions this panel is placed for", () => {
    expect(resolveAuditFilter(DEFAULT_AUDIT_FILTER_ID).action).toBe("fleet.*");
  });

  it("offers an unfiltered view, so nobody reads fleet.* as the whole trail", () => {
    expect(AUDIT_FILTERS.some((f) => f.action === null)).toBe(true);
  });

  it("falls back to the NARROWEST filter on an unknown id", () => {
    // Showing fewer rows than asked for is recoverable; silently widening to
    // every operator write in the tenant is a surprise.
    expect(resolveAuditFilter("nope").id).toBe(AUDIT_FILTERS[0]?.id);
  });

  it("gives every filter a hint stating its reach", () => {
    for (const f of AUDIT_FILTERS) expect(f.hint.length).toBeGreaterThan(0);
  });
});

describe("blastRadiusOf", () => {
  it("promotes the drain stamp coord writes", () => {
    const blast = blastRadiusOf(
      row({
        metadata: {
          device_id: "22222222-2222-2222-2222-222222222222",
          drained: true,
          until: "2026-09-01T12:00:00Z",
          reason: "clippy failing 2/2",
          version: 17,
        },
      })
    );
    expect(blast.unstated).toBe(false);
    const byKey = Object.fromEntries(blast.items.map((i) => [i.key, i.value]));
    expect(byKey["device_id"]).toBe("22222222-2222-2222-2222-222222222222");
    expect(byKey["drained"]).toBe("paused");
    expect(byKey["until"]).toBe("2026-09-01T12:00:00Z");
    expect(byKey["version"]).toBe("17");
  });

  it("promotes `affected_tenant_ids`, the operator_disable pattern", () => {
    const blast = blastRadiusOf(
      row({
        action: "operator.disable",
        metadata: { affected_tenant_ids: ["t-1", "t-2", "t-3"] },
      })
    );
    expect(blast.items[0]?.label).toBe("Tenants reached");
    expect(blast.items[0]?.value).toContain("3 — t-1, t-2, t-3");
  });

  it("promotes `affected_repos`, the kill switch's stamp", () => {
    const blast = blastRadiusOf(
      row({
        action: "pr_merge.kill_switch",
        metadata: { scope: "tenant", affected_repos: ["a/b", "a/c"] },
      })
    );
    const byKey = Object.fromEntries(blast.items.map((i) => [i.key, i.value]));
    expect(byKey["affected_repos"]).toContain("2 — a/b, a/c");
    expect(byKey["scope"]).toBe("tenant");
  });

  it("orders the reach widest-first", () => {
    const blast = blastRadiusOf(
      row({
        metadata: {
          device_id: "d-1",
          affected_repos: ["a/b"],
          affected_tenant_ids: ["t-1"],
        },
      })
    );
    expect(blast.items.map((i) => i.key)).toEqual([
      "affected_tenant_ids",
      "affected_repos",
      "device_id",
    ]);
  });

  it("distinguishes an EMPTY recorded reach from an unstated one", () => {
    // `affected_repos: []` is a measurement — the writer looked and found
    // nothing. No such key at all is a writer that never looked.
    const measured = blastRadiusOf(row({ metadata: { affected_repos: [] } }));
    expect(measured.unstated).toBe(false);
    expect(measured.items[0]?.value).toBe("none");

    expect(blastRadiusOf(row({ metadata: { reason: "x" } })).unstated).toBe(
      true
    );
    expect(blastRadiusOf(row({ metadata: {} })).unstated).toBe(true);
    expect(blastRadiusOf(row({ metadata: null })).unstated).toBe(true);
    expect(blastRadiusOf(row({ metadata: "nope" })).unstated).toBe(true);
  });

  it("ignores a blast-radius key whose value is null", () => {
    expect(blastRadiusOf(row({ metadata: { device_id: null } })).unstated).toBe(
      true
    );
  });
});

describe("isAuthorizationCheck", () => {
  it("catches a require_role stamp — resource_kind=http.route", () => {
    expect(
      isAuthorizationCheck(
        row({
          action: "rbac.allow",
          resource_kind: AUTHORIZATION_CHECK_RESOURCE_KIND,
          resource_key: "GET /admin/coord/audit/recent",
        })
      )
    ).toBe(true);
  });

  it("does not misreport a real write", () => {
    expect(isAuthorizationCheck(row())).toBe(false);
    expect(
      isAuthorizationCheck(row({ resource_kind: null }))
    ).toBe(false);
  });
});

describe("reasonOf", () => {
  it("reads the stated reason", () => {
    expect(reasonOf(row({ metadata: { reason: "clippy failing" } }))).toBe(
      "clippy failing"
    );
  });

  it("treats a blank or absent reason as none", () => {
    expect(reasonOf(row({ metadata: { reason: "   " } }))).toBeNull();
    expect(reasonOf(row({ metadata: {} }))).toBeNull();
  });
});

describe("isNilOperator", () => {
  it("catches coord's nil-UUID fallback", () => {
    // The signature of a coord writer that used
    // `resolve_operator_id(&headers)` — a header this service never sends —
    // whose FK violation `audit_mutation` then swallowed.
    expect(isNilOperator(row({ operator_id: NIL_OPERATOR_ID }))).toBe(true);
  });

  it("does not misreport a real operator", () => {
    expect(isNilOperator(row())).toBe(false);
    expect(isNilOperator(row({ operator_id: null }))).toBe(false);
  });
});

describe("parseAuditPayload", () => {
  it("reads coord's shape", () => {
    const read = parseAuditPayload({ audit: [row()], count: 1 });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.rows).toHaveLength(1);
  });

  it("an empty feed is a real measurement", () => {
    const read = parseAuditPayload({ audit: [], count: 0 });
    expect(read.state).toBe("ok");
  });

  it("a failed shape is UNAVAILABLE, never an empty feed", () => {
    expect(parseAuditPayload(null).state).toBe("unavailable");
    expect(parseAuditPayload({ audit: "nope" }).state).toBe("unavailable");
  });

  it("an ABSENT `audit` key is UNAVAILABLE too", () => {
    const read = parseAuditPayload({ count: 0 });
    expect(read.state).toBe("unavailable");
    if (read.state !== "unavailable") return;
    expect(read.reason).toMatch(/stated nothing about what was written/);
  });
});

describe("describeAuditAction — R8", () => {
  it("labels the actions this console knows", () => {
    expect(describeAuditAction("fleet.drain.set")).toEqual({
      label: "Paused coord dispatch to a machine",
      mapped: true,
    });
    expect(describeAuditAction("fleet.drain.clear").mapped).toBe(true);
  });

  it("falls back to the raw id, never to a friendly placeholder", () => {
    // The id is a real fact and a working filter term; "Unknown action" is
    // neither, and would hide the one string an operator could act on.
    expect(describeAuditAction("fleet.something.new")).toEqual({
      label: "fleet.something.new",
      mapped: false,
    });
  });
});
