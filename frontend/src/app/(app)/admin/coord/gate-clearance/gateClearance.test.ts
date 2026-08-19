/**
 * `gate_clearance` resolution — the client mirror of coord's
 * `fetch_policies_by_domain` candidate set + `gates_authority::pick_rule` +
 * `default_authority`.
 *
 * These pin BEHAVIOUR, not presence: every assertion compares the resolved
 * authority to the RULE SET it was computed from, so a change to either side
 * (band precedence, the priority/created_at tie-break, the skip arms, the
 * audience default) breaks a test. Asserting only that a cell renders would
 * leave the two sides free to drift — the defect class the plan's §9 forbids.
 *
 * The coord clauses each group mirrors are named inline.
 */

import { describe, expect, it } from "vitest";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import {
  authorityForAudience,
  buildCreateBody,
  classesInPlay,
  inertReason,
  nearMissRecommendedClass,
  parseGateClearancePayload,
  resolutionCandidates,
  resolveEffectiveAuthority,
  resolveWithout,
  type ClearanceAuthority,
} from "./gateClearance";

let seq = 0;

function rule(overrides: {
  gate_class?: string;
  authority?: string;
  built_in?: boolean;
  priority?: number;
  created_at?: string;
  enabled?: boolean;
  repo?: string | null;
  expires_at?: string | null;
  payload?: unknown;
  policy_id?: string;
  decision_domain?: string | null;
}): CoordPolicyRow {
  seq += 1;
  const {
    gate_class = "routine-review",
    authority = "agent_any",
    payload = { gate_class, authority },
    ...rest
  } = overrides;
  return {
    policy_id: `p-${seq}`,
    tenant_id: "t-1",
    repo: null,
    name: `rule ${seq}`,
    kind: null,
    decision_domain: "gate_clearance",
    mode: "data_driven",
    autonomy_level: "always_escalate",
    payload,
    condition: {},
    action: {},
    priority: 100,
    enabled: true,
    rationale: null,
    default_source: null,
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "op",
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: "op",
    built_in: false,
    override_state: null,
    system_rule_id: null,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Payload parsing — coord `ClearanceAuthority::parse` + `pick_rule`'s skip arms
// ---------------------------------------------------------------------------

describe("parseGateClearancePayload", () => {
  it("accepts exactly the three authorities coord parses", () => {
    for (const a of ["operator_only", "agent_non_author", "agent_any"]) {
      expect(
        parseGateClearancePayload({ gate_class: "x", authority: a })
      ).toEqual({ gate_class: "x", authority: a });
    }
  });

  it("rejects an authority coord's parse() would not know", () => {
    // coord returns None → `pick_rule` SKIPS the row (fail-safe to the default).
    expect(
      parseGateClearancePayload({ gate_class: "x", authority: "operator" })
    ).toBeNull();
    expect(
      parseGateClearancePayload({ gate_class: "x", authority: "AGENT_ANY" })
    ).toBeNull();
  });

  it("rejects a payload with no class, no authority, or no payload at all", () => {
    expect(parseGateClearancePayload({ authority: "agent_any" })).toBeNull();
    expect(parseGateClearancePayload({ gate_class: "x" })).toBeNull();
    expect(
      parseGateClearancePayload({ gate_class: "", authority: "agent_any" })
    ).toBeNull();
    expect(parseGateClearancePayload(null)).toBeNull();
    expect(parseGateClearancePayload("not an object")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The candidate set — coord `fetch_policies_by_domain`'s WHERE + ORDER BY
// ---------------------------------------------------------------------------

describe("resolutionCandidates", () => {
  it("orders tenant band before system band, then priority, then created_at", () => {
    const systemFirstPriority = rule({
      built_in: true,
      priority: 1,
      gate_class: "c",
    });
    const tenantLatePriority = rule({
      built_in: false,
      priority: 900,
      gate_class: "c",
    });
    const tenantSamePriorityOlder = rule({
      built_in: false,
      priority: 900,
      gate_class: "c",
      created_at: "2020-01-01T00:00:00Z",
    });

    const ordered = resolutionCandidates([
      systemFirstPriority,
      tenantLatePriority,
      tenantSamePriorityOlder,
    ]).map((c) => c.row.policy_id);

    expect(ordered).toEqual([
      tenantSamePriorityOlder.policy_id, // tenant, prio 900, oldest
      tenantLatePriority.policy_id, // tenant, prio 900, newer
      systemFirstPriority.policy_id, // system band last despite priority 1
    ]);
  });

  it("keeps a repo-scoped SYSTEM row — the system band has no repo predicate", () => {
    // resolver.rs: `OR ($4::uuid IS NOT NULL AND tenant_id = $4)` — the system
    // arm carries no repo clause at all, so a repo-scoped built-in still
    // decides. Dropping it would report "audience default" for a class a
    // system rule actually governs.
    const systemRepoScoped = rule({
      gate_class: "c",
      authority: "operator_only",
      built_in: true,
      repo: "qontinui-web",
    });
    expect(inertReason(systemRepoScoped)).toBeNull();
    const effective = resolveEffectiveAuthority([systemRepoScoped], "c");
    expect(effective.kind).toBe("rule");
    if (effective.kind !== "rule") return;
    expect(effective.band).toBe("system");
    expect(effective.authority).toBe("operator_only");
  });

  it("ranks a repo-'' workspace row in the Repo band, above every tenant row", () => {
    // `$3 = repo.unwrap_or("")`, so `repo = ''` satisfies `repo = $3` and
    // computes scope_band 0 — ahead of a tenant-wide row of ANY priority.
    const tenantWide = rule({
      gate_class: "c",
      authority: "operator_only",
      priority: 1,
    });
    const repoBand = rule({
      gate_class: "c",
      authority: "agent_any",
      priority: 9999,
      repo: "",
    });
    const effective = resolveEffectiveAuthority([tenantWide, repoBand], "c");
    expect(effective.kind).toBe("rule");
    if (effective.kind !== "rule") return;
    expect(effective.rule.policy_id).toBe(repoBand.policy_id);
    expect(effective.authority).toBe("agent_any");
  });

  it("drops every row coord's SELECT would not return", () => {
    const kept = rule({ gate_class: "c" });
    const dropped = [
      rule({ gate_class: "c", enabled: false }),
      rule({ gate_class: "c", repo: "qontinui-web" }),
      rule({ gate_class: "c", expires_at: "2020-01-01T00:00:00Z" }),
      rule({ gate_class: "c", payload: { gate_class: "c" } }),
      rule({ gate_class: "c", payload: {} }),
      rule({ decision_domain: "merge_sequencing" }),
    ];
    const ids = resolutionCandidates([kept, ...dropped]).map(
      (c) => c.row.policy_id
    );
    expect(ids).toEqual([kept.policy_id]);
  });
});

describe("inertReason names the clause that excludes a row", () => {
  it.each([
    ["disabled", rule({ enabled: false })],
    ["repo-scoped", rule({ repo: "qontinui-coord" })], // workspace row only
    ["expired", rule({ expires_at: "2020-01-01T00:00:00Z" })],
    ["no-class", rule({ payload: { authority: "agent_any" } })],
    [
      "unknown-authority",
      rule({ payload: { gate_class: "c", authority: "nope" } }),
    ],
  ])("%s", (reason, row) => {
    expect(inertReason(row)).toBe(reason);
  });

  it("returns null for a row coord would resolve", () => {
    expect(inertReason(rule({}))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resolution — coord `pick_rule` + `default_authority`
// ---------------------------------------------------------------------------

describe("resolveEffectiveAuthority", () => {
  it("a tenant rule beats a system rule for the same class, whatever the priority", () => {
    const system = rule({
      built_in: true,
      priority: 1,
      gate_class: "security-surface",
      authority: "operator_only",
    });
    const tenant = rule({
      built_in: false,
      priority: 9999,
      gate_class: "security-surface",
      authority: "agent_any",
    });

    const effective = resolveEffectiveAuthority(
      [system, tenant],
      "security-surface"
    );

    expect(effective.kind).toBe("rule");
    if (effective.kind !== "rule") return;
    // The answer AGREES with the rule set: the winner is the tenant row, and
    // the reported authority is that row's own payload authority.
    expect(effective.rule.policy_id).toBe(tenant.policy_id);
    expect(effective.band).toBe("tenant");
    expect(effective.authority).toBe(
      parseGateClearancePayload(tenant.payload)?.authority
    );
    expect(effective.shadowed.map((c) => c.row.policy_id)).toEqual([
      system.policy_id,
    ]);
  });

  it("falls to the system rule once the tenant rule is gone", () => {
    const system = rule({
      built_in: true,
      gate_class: "routine-review",
      authority: "agent_any",
    });
    const tenant = rule({
      built_in: false,
      gate_class: "routine-review",
      authority: "operator_only",
    });

    const withTenant = resolveEffectiveAuthority(
      [system, tenant],
      "routine-review"
    );
    const withoutTenant = resolveWithout(
      [system, tenant],
      "routine-review",
      tenant.policy_id
    );

    expect(withTenant.kind === "rule" && withTenant.authority).toBe(
      "operator_only"
    );
    expect(withoutTenant.kind).toBe("rule");
    if (withoutTenant.kind !== "rule") return;
    expect(withoutTenant.band).toBe("system");
    expect(withoutTenant.rule.policy_id).toBe(system.policy_id);
    expect(withoutTenant.authority).toBe(
      parseGateClearancePayload(system.payload)?.authority
    );
  });

  it("falls all the way to the AUDIENCE default with no rule left", () => {
    const tenant = rule({
      gate_class: "ops-confirm",
      authority: "operator_only",
    });

    const after = resolveWithout([tenant], "ops-confirm", tenant.policy_id);

    expect(after.kind).toBe("audience-default");
    // Coord's `default_authority`: audience-dependent, so BOTH arms, never one.
    expect(authorityForAudience(after, "operator")).toBe("operator_only");
    expect(authorityForAudience(after, "agent")).toBe("agent_any");
  });

  it("an unparseable rule is skipped and the NEXT matching rule decides", () => {
    const broken = rule({
      priority: 1,
      gate_class: "routine-review",
      payload: { gate_class: "routine-review", authority: "yes-please" },
    });
    const good = rule({
      priority: 2,
      gate_class: "routine-review",
      authority: "agent_non_author",
    });

    const effective = resolveEffectiveAuthority(
      [broken, good],
      "routine-review"
    );

    expect(effective.kind).toBe("rule");
    if (effective.kind !== "rule") return;
    expect(effective.rule.policy_id).toBe(good.policy_id);
    expect(effective.authority).toBe("agent_non_author");
  });

  it("never lets a rule for one class decide another class", () => {
    const other = rule({ gate_class: "ops-confirm", authority: "agent_any" });
    expect(resolveEffectiveAuthority([other], "routine-review").kind).toBe(
      "audience-default"
    );
  });

  it("matches the class byte-exactly — case and whitespace are different classes", () => {
    const spaced = rule({
      gate_class: "security-surface ",
      authority: "agent_any",
    });
    const cased = rule({
      gate_class: "Security-Surface",
      authority: "agent_any",
    });

    expect(
      resolveEffectiveAuthority([spaced, cased], "security-surface").kind
    ).toBe("audience-default");
    // …and each typo'd class is itself resolvable, i.e. the rules are live but
    // pointed at a bucket no gate is in.
    expect(
      resolveEffectiveAuthority([spaced, cased], "security-surface ").kind
    ).toBe("rule");
  });

  it("an audience default is returned as BOTH arms, never as one authority", () => {
    const effective = resolveEffectiveAuthority([], "anything");
    expect(effective).toEqual({
      kind: "audience-default",
      operatorAudience: "operator_only",
      agentAudience: "agent_any",
    });
  });
});

describe("authorityForAudience", () => {
  it("ignores the audience once a rule decided (the rule is audience-blind)", () => {
    const tenant = rule({ gate_class: "c", authority: "operator_only" });
    const effective = resolveEffectiveAuthority([tenant], "c");
    for (const audience of ["operator", "agent"] as const) {
      expect(authorityForAudience(effective, audience)).toBe("operator_only");
    }
  });
});

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

describe("classesInPlay", () => {
  it("always lists the three recommended classes, recommended ones first", () => {
    expect(classesInPlay([])).toEqual([
      "security-surface",
      "routine-review",
      "ops-confirm",
    ]);
  });

  it("surfaces a class only an INERT rule mentions, so a typo is visible", () => {
    const typo = rule({
      gate_class: "secuirty-surface",
      enabled: false,
    });
    expect(classesInPlay([typo])).toContain("secuirty-surface");
  });
});

describe("nearMissRecommendedClass", () => {
  it.each([
    ["Security-Surface", "security-surface"],
    ["  routine-review ", "routine-review"],
    ["ops_confirm", "ops-confirm"],
  ])("%s is a near miss for %s", (value, expected) => {
    expect(nearMissRecommendedClass(value)).toBe(expected);
  });

  it("is null for an exact match and for a genuinely different class", () => {
    expect(nearMissRecommendedClass("security-surface")).toBeNull();
    expect(nearMissRecommendedClass("my-own-class")).toBeNull();
  });
});

describe("buildCreateBody", () => {
  it("emits the v2 decision-domain shape coord's derive_create_shape accepts", () => {
    const body = buildCreateBody({
      name: "  Ops confirm  ",
      gateClass: "ops-confirm",
      authority: "agent_any" as ClearanceAuthority,
      priority: 50,
      rationale: "  because  ",
    });
    expect(body).toEqual({
      name: "Ops confirm",
      decision_domain: "gate_clearance",
      mode: "data_driven",
      payload: { gate_class: "ops-confirm", authority: "agent_any" },
      priority: 50,
      rationale: "because",
    });
    // Coord 400s a repo-scoped gate_clearance rule; the body must never carry one.
    expect(body).not.toHaveProperty("repo");
  });

  it("omits an empty rationale rather than sending a blank string", () => {
    const body = buildCreateBody({
      name: "x",
      gateClass: "c",
      authority: "agent_any",
      rationale: "   ",
    });
    expect(body).not.toHaveProperty("rationale");
    expect(body).not.toHaveProperty("priority");
  });
});
