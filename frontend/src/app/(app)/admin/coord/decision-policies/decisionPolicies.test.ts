/**
 * The pure half of the decision-policy surface.
 *
 * Everything here asserts LITERALS — the five domain strings, the three
 * autonomy values, the exact keys of a create body. Asserting against the
 * module's own constants would make each test a tautology that survives any
 * edit to the thing it is supposed to pin, which is exactly the failure mode
 * on a surface whose whole job is to send coord a wire shape coord accepts.
 */

import { describe, expect, it } from "vitest";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import {
  AUTONOMY_LEVELS,
  buildCreateBody,
  canonicalPayload,
  CREATE_IS_INERT,
  DECISION_POLICY_DOMAINS,
  DECISION_POLICY_MODES,
  DEFAULT_DECISION_DOMAIN,
  isDecisionPolicyDomain,
  isDecisionPolicyRow,
  isLoosening,
  parseAutonomyLevel,
  payloadToText,
  validateDecisionPayload,
} from "./decisionPolicies";

// The five domains coord's own `next_step_settings::DOMAIN_SPECS` manages,
// spelled out rather than imported: a widening of this page's authorable set
// is a security-surface edit and must red a test, not pass silently.
const EXPECTED_DOMAINS = [
  "next_step",
  "pr_fix",
  "red_main_fix",
  "architecture_tradeoff",
  "verification_sufficiency",
];

function row(patch: Partial<CoordPolicyRow> = {}): CoordPolicyRow {
  return {
    policy_id: "p1",
    tenant_id: "t1",
    repo: null,
    name: "a policy",
    kind: null,
    decision_domain: "pr_fix",
    mode: "guidance",
    autonomy_level: "always_escalate",
    payload: {},
    condition: {},
    action: {},
    priority: 100,
    enabled: true,
    rationale: null,
    default_source: null,
    expires_at: null,
    created_at: "2026-09-01T00:00:00Z",
    created_by: "operator:someone",
    updated_at: "2026-09-01T00:00:00Z",
    updated_by: "operator:someone",
    built_in: false,
    override_state: null,
    system_rule_id: null,
    ...patch,
  };
}

describe("the authorable domain set", () => {
  it("is exactly coord's five façade-managed next_step domains", () => {
    expect(DECISION_POLICY_DOMAINS.map((d) => d.domain)).toEqual(
      EXPECTED_DOMAINS
    );
  });

  it("does not offer gate_clearance or terminal_auto_response", () => {
    // Both are real coord decision domains, and neither belongs on this page:
    // `gate_clearance` has its own surface with an authority preview, and
    // `terminal_auto_response` is the domain the runner-rules feed reads to
    // inject text into live terminals fleet-wide.
    expect(isDecisionPolicyDomain("gate_clearance")).toBe(false);
    expect(isDecisionPolicyDomain("terminal_auto_response")).toBe(false);
  });

  it("starts a create form on a domain that is in the set", () => {
    expect(EXPECTED_DOMAINS).toContain(DEFAULT_DECISION_DOMAIN);
  });

  it("claims a pr_fix row and disclaims a gate_clearance one", () => {
    expect(isDecisionPolicyRow(row({ decision_domain: "pr_fix" }))).toBe(true);
    expect(
      isDecisionPolicyRow(row({ decision_domain: "gate_clearance" }))
    ).toBe(false);
    expect(isDecisionPolicyRow(row({ decision_domain: null }))).toBe(false);
  });

  it("offers exactly the two v2 modes coord's CHECK permits", () => {
    expect([...DECISION_POLICY_MODES]).toEqual(["guidance", "data_driven"]);
  });
});

describe("the create body", () => {
  it("carries decision_domain + mode + payload and no v1 field", () => {
    const body = buildCreateBody({
      name: "  pr_fix frame  ",
      decisionDomain: "pr_fix",
      mode: "guidance",
      payload: { notes: "hello" },
      repo: " qontinui/qontinui-dev-notes ",
      priority: 50,
      rationale: "  because  ",
    });

    expect(body).toEqual({
      name: "pr_fix frame",
      decision_domain: "pr_fix",
      mode: "guidance",
      payload: { notes: "hello" },
      repo: "qontinui/qontinui-dev-notes",
      priority: 50,
      rationale: "because",
    });
    // Coord's `derive_create_shape` 400s a body mixing the two shapes.
    expect(Object.keys(body)).not.toContain("kind");
    expect(Object.keys(body)).not.toContain("condition");
    expect(Object.keys(body)).not.toContain("action");
  });

  it("never carries autonomy_level — coord has no such field on create", () => {
    const body = buildCreateBody({
      name: "n",
      decisionDomain: "pr_fix",
      mode: "guidance",
      payload: {},
    });
    expect(Object.keys(body)).not.toContain("autonomy_level");
  });

  it("omits blank repo and rationale rather than sending empty strings", () => {
    const body = buildCreateBody({
      name: "n",
      decisionDomain: "pr_fix",
      mode: "guidance",
      payload: {},
      repo: "   ",
      rationale: "  ",
    });
    expect(Object.keys(body).sort()).toEqual([
      "decision_domain",
      "mode",
      "name",
      "payload",
    ]);
  });
});

describe("the autonomy dial", () => {
  it("is exactly coord's three values", () => {
    expect([...AUTONOMY_LEVELS]).toEqual([
      "always_escalate",
      "guidance_only",
      "auto_decide",
    ]);
  });

  it("reads an unknown level as UNKNOWN rather than defaulting it", () => {
    expect(parseAutonomyLevel("auto_decide")).toBe("auto_decide");
    expect(parseAutonomyLevel("shadow")).toBeNull();
    expect(parseAutonomyLevel(null)).toBeNull();
  });

  it("classifies every move up the dial as a loosening and none down", () => {
    expect(isLoosening("always_escalate", "guidance_only")).toBe(true);
    expect(isLoosening("always_escalate", "auto_decide")).toBe(true);
    expect(isLoosening("guidance_only", "auto_decide")).toBe(true);
    expect(isLoosening("auto_decide", "guidance_only")).toBe(false);
    expect(isLoosening("guidance_only", "always_escalate")).toBe(false);
    expect(isLoosening("auto_decide", "auto_decide")).toBe(false);
  });

  it("says in the inert copy that a created row lands at always_escalate", () => {
    expect(CREATE_IS_INERT).toContain("always_escalate");
    expect(CREATE_IS_INERT).toContain("escalated_no_policy");
    expect(CREATE_IS_INERT).toContain("escalated_by_policy");
  });
});

describe("payload validation — the blocking arm", () => {
  it("refuses text that is not JSON, naming the parse failure", () => {
    const v = validateDecisionPayload("{ not json", "guidance");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/^Not valid JSON: /);
  });

  it("refuses JSON that is not an object", () => {
    for (const text of ["[]", '"a string"', "42", "null"]) {
      const v = validateDecisionPayload(text, "guidance");
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain("must be a JSON object");
    }
  });

  it("refuses an empty box and says what to type instead", () => {
    const v = validateDecisionPayload("   ", "guidance");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("{}");
  });

  it("accepts an empty object with no warnings", () => {
    const v = validateDecisionPayload("{}", "guidance");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.warnings).toEqual([]);
      expect(v.unread).toEqual([]);
      expect(v.value).toEqual({});
    }
  });
});

describe("payload validation — the fields coord silently drops", () => {
  it("accepts the operator-approved pr_fix body shape cleanly", () => {
    const v = validateDecisionPayload(
      JSON.stringify({
        constraints: [
          { severity: "hard", check: "never merge", rationale: "coord merges" },
          { severity: "soft", check: "prefer a plain rebase" },
        ],
        rubric: {
          instructions: "Decide the single best next step.",
          score_on: ["powerful", "scalable", "robust", "clean"],
        },
        notes: "Pilot scope: one repo.",
      }),
      "guidance"
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings).toEqual([]);
  });

  it("warns that ONE bad constraint drops every constraint", () => {
    const v = validateDecisionPayload(
      JSON.stringify({
        constraints: [
          { severity: "hard", check: "fine" },
          { severity: "blocking", check: "not a coord severity" },
        ],
      }),
      "guidance"
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.warnings).toHaveLength(1);
    expect(v.warnings[0]?.path).toBe("constraints[1].severity");
    expect(v.warnings[0]?.message).toContain(
      "EVERY constraint in this rule is dropped"
    );
  });

  it("warns on a non-array constraints field", () => {
    const v = validateDecisionPayload(
      JSON.stringify({ constraints: { severity: "hard" } }),
      "guidance"
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings.map((w) => w.path)).toEqual(["constraints"]);
  });

  it("warns on a rubric with no instructions, and on a bad score_on", () => {
    const v = validateDecisionPayload(
      JSON.stringify({ rubric: { score_on: ["powerful", 3] } }),
      "guidance"
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.warnings.map((w) => w.path)).toEqual([
        "rubric.instructions",
        "rubric.score_on",
      ]);
      expect(v.warnings[0]?.message).toContain("drops the whole rubric");
    }
  });

  it("warns on non-string notes", () => {
    const v = validateDecisionPayload(
      JSON.stringify({ notes: ["a", "b"] }),
      "guidance"
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings.map((w) => w.path)).toEqual(["notes"]);
  });

  it("warns that a data_driven row with no query serves the plain frame", () => {
    const withQuery = validateDecisionPayload(
      JSON.stringify({ query: { id: "some_query" } }),
      "data_driven"
    );
    expect(withQuery.ok).toBe(true);
    if (withQuery.ok) expect(withQuery.warnings).toEqual([]);

    const without = validateDecisionPayload("{}", "data_driven");
    expect(without.ok).toBe(true);
    if (without.ok)
      expect(without.warnings.map((w) => w.path)).toEqual(["query"]);
  });

  it("reports a `query` key as UNREAD in guidance mode and read in data_driven", () => {
    const guidance = validateDecisionPayload(
      JSON.stringify({ query: { id: "q" } }),
      "guidance"
    );
    expect(guidance.ok).toBe(true);
    if (guidance.ok) expect(guidance.unread).toEqual(["query"]);

    const dataDriven = validateDecisionPayload(
      JSON.stringify({ query: { id: "q" } }),
      "data_driven"
    );
    expect(dataDriven.ok).toBe(true);
    if (dataDriven.ok) expect(dataDriven.unread).toEqual([]);
  });

  it("reports an invented top-level key as unread", () => {
    const v = validateDecisionPayload(
      JSON.stringify({ rubrick: { instructions: "typo'd key" } }),
      "guidance"
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.unread).toEqual(["rubrick"]);
      expect(v.warnings).toEqual([]);
    }
  });
});

describe("payload text helpers", () => {
  it("renders null as an empty object rather than the string 'null'", () => {
    expect(payloadToText(null)).toBe("{}");
    expect(payloadToText(undefined)).toBe("{}");
  });

  it("treats a reformat and a key reorder as the SAME payload", () => {
    // This is what keeps a reindent from taking the destructive replace path.
    expect(canonicalPayload({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      canonicalPayload({ a: [1, { c: 3, d: 2 }], b: 1 })
    );
  });

  it("treats a value change as a different payload", () => {
    expect(canonicalPayload({ notes: "a" })).not.toBe(
      canonicalPayload({ notes: "b" })
    );
  });
});
