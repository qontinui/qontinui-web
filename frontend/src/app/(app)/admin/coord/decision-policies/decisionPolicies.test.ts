/**
 * The pure half of the decision-policy surface.
 *
 * Everything here asserts LITERALS — the six domain strings, the three
 * autonomy values, the exact keys of a create body. Asserting against the
 * module's own constants would make each test a tautology that survives any
 * edit to the thing it is supposed to pin, which is exactly the failure mode
 * on a surface whose whole job is to send coord a wire shape coord accepts.
 */

import { describe, expect, it } from "vitest";
import type { CoordPolicyRow } from "@/lib/api/operations/coordPolicies";
import {
  AUTONOMY_LEVELS,
  buildCreateBody,
  canonicalPayload,
  createDefaultCaution,
  CREATE_IS_INERT,
  effectiveCreateRepo,
  DECISION_POLICY_DOMAINS,
  DECISION_POLICY_MODES,
  DEFAULT_DECISION_DOMAIN,
  domainSpec,
  isDecisionPolicyDomain,
  isDecisionPolicyRow,
  isLoosening,
  parseAutonomyLevel,
  isCoordSystemRow,
  isLiveRow,
  payloadToText,
  priorityEditCaution,
  ranksAbove,
  readWithoutDeletedWorkspaceRow,
  releaseClause,
  replaceRankCaution,
  sameScopeRows,
  scopeEditCaution,
  systemDefaultFor,
  validateDecisionPayload,
} from "./decisionPolicies";

// The six domains coord's own `next_step_settings::DOMAIN_SPECS` manages,
// spelled out rather than imported: a widening of this page's authorable set
// is a security-surface edit and must red a test, not pass silently.
const EXPECTED_DOMAINS = [
  "next_step",
  "pr_fix",
  "red_main_fix",
  "admission_stall_fix",
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
  it("is exactly coord's six façade-managed next_step domains", () => {
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

  it("marks admission_stall_fix as gated beyond auto_decide", () => {
    // coord's DomainSpec carries master_flag
    // COORD_ADMISSION_STALL_FIX_AUTODISPATCH_ENABLED for this domain, so the
    // graduation caveat must be shown for it.
    expect(domainSpec("admission_stall_fix")?.requiresMaster).toBe(true);
  });

  it("claims coord's seeded admission_stall_fix system row", () => {
    // coord seeds this row in the system band at auto_decide; before the
    // mirror carried the domain, the page silently hid it.
    expect(
      isDecisionPolicyRow(
        row({ decision_domain: "admission_stall_fix", built_in: true })
      )
    ).toBe(true);
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

  it("never sends a repo for admission_stall_fix — its consults carry none", () => {
    const body = buildCreateBody({
      name: "n",
      decisionDomain: "admission_stall_fix",
      mode: "guidance",
      payload: {},
      repo: "qontinui/qontinui-web",
    });
    expect(Object.keys(body)).not.toContain("repo");
    expect(body.decision_domain).toBe("admission_stall_fix");
  });

  it("still sends a repo for a domain whose consults carry one", () => {
    const body = buildCreateBody({
      name: "n",
      decisionDomain: "red_main_fix",
      mode: "guidance",
      payload: {},
      repo: "qontinui/qontinui-web",
    });
    expect(body.repo).toBe("qontinui/qontinui-web");
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

  it("does not claim the hold marker is unconditionally the only change", () => {
    // A tenant row outranks coord's system row, so for a domain with a system
    // default above always_escalate the hold marker is NOT the only change.
    expect(CREATE_IS_INERT).not.toContain("the only thing that changes");
    expect(CREATE_IS_INERT).toContain("outranks");
  });
});

describe("repo scope, per domain", () => {
  // Spelled out, not imported: mirrors coord's DarkArm::consults_carry_repo.
  it("marks only admission_stall_fix as consulted without a repo", () => {
    expect(
      Object.fromEntries(
        DECISION_POLICY_DOMAINS.map((d) => [d.domain, d.repoScoped])
      )
    ).toEqual({
      next_step: true,
      pr_fix: true,
      red_main_fix: true,
      admission_stall_fix: false,
      architecture_tradeoff: true,
      verification_sufficiency: true,
    });
  });

  it("drops a typed repo only for the repo-less domain", () => {
    expect(effectiveCreateRepo("admission_stall_fix", "o/r")).toBe("");
    expect(effectiveCreateRepo("pr_fix", " o/r ")).toBe("o/r");
    expect(effectiveCreateRepo("pr_fix", undefined)).toBe("");
  });

  it("records no static default level — coord's is read live", () => {
    for (const d of DECISION_POLICY_DOMAINS) {
      expect(Object.keys(d)).not.toContain("systemDefault");
    }
  });
});

describe("reading coord's served default for a domain", () => {
  const served = [
    {
      decision_domain: "admission_stall_fix",
      default_autonomy_level: "auto_decide",
      default_source: "system_row",
      resolved_from: "system",
      autonomy_level: "auto_decide",
    },
    {
      decision_domain: "verification_sufficiency",
      default_autonomy_level: "guidance_only",
      default_source: "code_fallback",
    },
  ];

  it("is loading before any read has answered", () => {
    expect(systemDefaultFor(null, null, "pr_fix")).toEqual({
      state: "loading",
    });
  });

  it("is UNKNOWN when the read failed", () => {
    expect(systemDefaultFor(null, "boom", "pr_fix")).toEqual({
      state: "unknown",
      reason: "boom",
    });
  });

  it("is UNKNOWN when the domain is missing from the response", () => {
    expect(systemDefaultFor(served, null, "pr_fix").state).toBe("unknown");
  });

  it("carries the served level, source, winning band and current level", () => {
    expect(systemDefaultFor(served, null, "admission_stall_fix")).toEqual({
      state: "known",
      level: "auto_decide",
      source: "system_row",
      resolvedFrom: "system",
      currentLevel: "auto_decide",
    });
  });
});

describe("the create form's caution about coord's default", () => {
  const known = (
    level: string,
    source: string | null,
    resolvedFrom: string | null = "system",
    currentLevel: string | null = level
  ) => ({ state: "known", level, source, resolvedFrom, currentLevel }) as const;

  it("warns that a workspace-wide row turns off an auto_decide system row", () => {
    expect(
      createDefaultCaution(known("auto_decide", "system_row"), "")
    ).toEqual({
      kind: "override",
      text:
        "This domain has a coord system default at auto_decide. A workspace-wide row created here " +
        "outranks it and takes effect at always_escalate — so creating one turns that default off " +
        "for your workspace until you graduate this row. (For the system tenant's own rows, a new row " +
        "shares the seed's band and must out-prioritise it — and one that does changes the default for every tenant, not one workspace.)",
    });
  });

  it("warns for a guidance_only system row too — overriding it changes behavior", () => {
    expect(
      createDefaultCaution(known("guidance_only", "system_row"), "")?.text
    ).toContain("system default at guidance_only");
  });

  it("scopes the warning to the repo for a repo-scoped row", () => {
    const c = createDefaultCaution(known("auto_decide", "system_row"), "o/r");
    expect(c?.kind).toBe("override");
    expect(c?.text).toContain("A row scoped to o/r outranks it for that repo");
    expect(c?.text).toContain("Other repos keep the default.");
  });

  it("says nothing for a code_fallback default — there is no row to override", () => {
    expect(
      createDefaultCaution(known("guidance_only", "code_fallback"), "")
    ).toBeNull();
  });

  it("says nothing for a system row already at always_escalate", () => {
    expect(
      createDefaultCaution(known("always_escalate", "system_row"), "")
    ).toBeNull();
  });

  it("says it is reading while loading, and is UNKNOWN after a failed read", () => {
    expect(createDefaultCaution({ state: "loading" }, "")).toEqual({
      kind: "loading",
      text: "Reading coord's current default for this domain…",
    });
    const failed = createDefaultCaution(
      { state: "unknown", reason: "coord unreachable" },
      ""
    );
    expect(failed?.kind).toBe("unknown");
    expect(failed?.text).toBe(
      "Could not read coord's current default for this domain (coord unreachable). If coord has a " +
        "system default above always_escalate, a workspace-wide row created here outranks it and turns " +
        "it off for your workspace until you graduate this row."
    );
  });

  it("defers to an existing workspace override instead of claiming to turn the default off", () => {
    expect(
      createDefaultCaution(
        known("auto_decide", "system_row", "tenant", "guidance_only"),
        ""
      )
    ).toEqual({
      kind: "override",
      text:
        "A workspace row already overrides coord's default for this domain at guidance_only; a new row " +
        "takes effect only if it outranks that row (lower priority number, then older).",
    });
  });

  it("still warns about an existing workspace override when the default is a code_fallback", () => {
    // The tenant row is what a new row competes with, whatever the default.
    expect(
      createDefaultCaution(
        known("guidance_only", "code_fallback", "tenant", "auto_decide"),
        ""
      )?.text
    ).toContain("A workspace row already overrides coord's default");
  });

  it("says a repo row outranks an existing workspace override for that repo", () => {
    const c = createDefaultCaution(
      known("auto_decide", "system_row", "tenant", "auto_decide"),
      "o/r"
    );
    expect(c?.text).toContain(
      "A workspace row already overrides coord's default for this domain at auto_decide. A row scoped " +
        "to o/r outranks it for that repo"
    );
    expect(
      createDefaultCaution(
        known("auto_decide", "system_row", "tenant", "always_escalate"),
        "o/r"
      )
    ).toBeNull();
  });

  it("is UNKNOWN, not the system text, for an unrecognised resolved_from", () => {
    const c = createDefaultCaution(
      known("auto_decide", "system_row", "galaxy"),
      ""
    );
    expect(c?.kind).toBe("unknown");
    expect(c?.text).toContain("unrecognised resolved_from: galaxy");
    expect(
      createDefaultCaution(known("auto_decide", "system_row", null), "")?.kind
    ).toBe("unknown");
  });

  it("is UNKNOWN for a source or level this build does not recognise", () => {
    expect(createDefaultCaution(known("auto_decide", null), "")?.kind).toBe(
      "unknown"
    );
    expect(createDefaultCaution(known("shadow", "system_row"), "")?.kind).toBe(
      "unknown"
    );
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

describe("an in-place scope edit's caution", () => {
  const sys = {
    state: "known",
    level: "auto_decide",
    source: "system_row",
    resolvedFrom: "system",
    currentLevel: "auto_decide",
  } as const;

  it("is silent when the scope does not change", () => {
    expect(
      scopeEditCaution(sys, "o/r", " o/r ", "auto_decide", "pr_fix")
    ).toBeNull();
    expect(scopeEditCaution(sys, "", "", "auto_decide", "pr_fix")).toBeNull();
  });

  it("names the row's CURRENT level when a repo row goes workspace-wide", () => {
    expect(scopeEditCaution(sys, "o/r", "", "guidance_only", "pr_fix")).toBe(
      "Workspace-wide, this row (at guidance_only) outranks coord's system default (auto_decide) for " +
        "every repo without its own row. o/r stops using this row and goes back to " +
        "another workspace row or coord's default (at auto_decide)."
    );
  });

  it("names the new repo and what the old scope falls back to on a move A → B", () => {
    const c = scopeEditCaution(sys, "o/a", "o/b", "auto_decide", "pr_fix");
    expect(c).toContain(
      "For o/b, this row will outrank coord's system default and any workspace row at this row's level auto_decide."
    );
    expect(c).toContain("o/a stops using this row");
  });

  it("defers to an existing workspace override when going workspace-wide", () => {
    expect(
      scopeEditCaution(
        { ...sys, resolvedFrom: "tenant", currentLevel: "guidance_only" },
        "o/r",
        "",
        "auto_decide",
        "pr_fix"
      )
    ).toContain(
      "takes effect only if it outranks that row (lower priority number, then older), and then at this row's level auto_decide"
    );
  });

  it("is honest about an unread default", () => {
    expect(
      scopeEditCaution({ state: "loading" }, "o/r", "", "auto_decide", "pr_fix")
    ).toContain("Reading coord's current default for this domain…");
    expect(
      scopeEditCaution(
        { state: "unknown", reason: "boom" },
        "o/r",
        "",
        "auto_decide",
        "pr_fix"
      )
    ).toContain(
      "Could not read coord's current default for this domain (boom)"
    );
  });
});

describe("the repo band the settings read cannot see", () => {
  const sys = {
    state: "known",
    level: "auto_decide",
    source: "system_row",
    resolvedFrom: "system",
    currentLevel: "auto_decide",
  } as const;

  it("finds same-domain, same-repo rows, minus the edited and disabled ones", () => {
    const rows = [
      row({
        policy_id: "a",
        decision_domain: "pr_fix",
        repo: "o/r",
        name: "A",
      }),
      row({
        policy_id: "b",
        decision_domain: "pr_fix",
        repo: "o/r",
        name: "B",
      }),
      row({
        policy_id: "c",
        decision_domain: "pr_fix",
        repo: "o/x",
        name: "C",
      }),
      row({ policy_id: "d", decision_domain: "red_main_fix", repo: "o/r" }),
      row({
        policy_id: "e",
        decision_domain: "pr_fix",
        repo: "o/r",
        enabled: false,
      }),
      row({ policy_id: "f", decision_domain: "pr_fix", repo: null }),
      row({
        policy_id: "g",
        decision_domain: "pr_fix",
        repo: "o/r",
        name: "expired",
        expires_at: "2026-10-01T00:00:00Z",
      }),
      row({
        policy_id: "h",
        decision_domain: "pr_fix",
        repo: "o/r",
        name: "not yet expired",
        expires_at: "2026-11-01T00:00:00Z",
      }),
    ];
    const now = Date.parse("2026-10-14T00:00:00Z");
    expect(sameScopeRows(rows, "pr_fix", " o/r ", "b", null, now)).toEqual({
      loaded: true,
      rows: [
        {
          name: "A",
          autonomy_level: "always_escalate",
          priority: 100,
          created_at: "2026-09-01T00:00:00Z",
          policy_id: "a",
        },
        {
          name: "not yet expired",
          autonomy_level: "always_escalate",
          priority: 100,
          created_at: "2026-09-01T00:00:00Z",
          policy_id: "h",
        },
      ],
    });
    expect(sameScopeRows(null, "pr_fix", "o/r", null)).toEqual({
      loaded: false,
    });
  });

  it("names an existing same-repo row and says the new one must outrank it", () => {
    expect(
      createDefaultCaution(sys, "o/r", {
        loaded: true,
        rows: [
          { name: "repo frame", autonomy_level: "auto_decide", priority: 50 },
        ],
      })
    ).toEqual({
      kind: "override",
      text:
        'A row scoped to o/r already exists for this domain: "repo frame" (at auto_decide, priority 50). ' +
        "This row takes effect for o/r only if it outranks it (lower priority number, then older), and " +
        'then at always_escalate. Because "repo frame" is above always_escalate, a new row at ' +
        "always_escalate that outranks it may disarm it for o/r.",
    });
  });

  it("does not claim a disarm when the existing repo row is already always_escalate", () => {
    const c = createDefaultCaution(sys, "o/r", {
      loaded: true,
      rows: [
        { name: "held", autonomy_level: "always_escalate", priority: 100 },
      ],
    });
    expect(c?.text).toContain('"held" (at always_escalate, priority 100)');
    expect(c?.text).not.toContain("disarm");
  });

  it("keeps the plain text when the repo scope is empty", () => {
    expect(
      createDefaultCaution(sys, "o/r", { loaded: true, rows: [] })?.text
    ).toBe(
      "This domain has a coord system default at auto_decide. A row scoped to o/r outranks it for " +
        "that repo and takes effect at always_escalate — so creating one turns that default off for o/r " +
        "until you graduate this row. Other repos keep the default."
    );
  });

  it("qualifies the claim when the workspace's rows are not loaded", () => {
    expect(createDefaultCaution(sys, "o/r", { loaded: false })?.text).toContain(
      "This holds unless another row scoped to o/r ranks above it"
    );
    // A workspace-wide row is not in the repo band: no qualifier.
    expect(
      createDefaultCaution(sys, "", { loaded: false })?.text
    ).not.toContain("unless another row scoped");
  });

  it("names an existing same-repo row for an in-place move too", () => {
    expect(
      scopeEditCaution(sys, "", "o/r", "auto_decide", "pr_fix", {
        loaded: true,
        rows: [
          { name: "held", autonomy_level: "always_escalate", priority: 10 },
        ],
      })
    ).toContain(
      'A row scoped to o/r already exists for this domain: "held" (at always_escalate, priority 10).'
    );
  });
});

describe("the release clause", () => {
  const known = (
    level: string,
    source: string,
    resolvedFrom = "system",
    currentLevel = level
  ) => ({ state: "known", level, source, resolvedFrom, currentLevel }) as const;

  it("says narrowing a workspace row can re-arm a system default for the other repos", () => {
    expect(
      releaseClause(known("auto_decide", "system_row"), "", "o/r", "pr_fix")
    ).toBe(
      "Repos other than o/r stop using this row and go back to coord's default (at auto_decide), " +
        "unless another workspace row covers them. With coord's system default at auto_decide, this can " +
        "re-arm dispatch for those repos."
    );
  });

  it("names a code_fallback default as no row", () => {
    expect(
      releaseClause(
        known("guidance_only", "code_fallback"),
        "",
        "o/r",
        "pr_fix"
      )
    ).toContain("coord's default (no system row — consults escalate)");
  });

  it("allows that this row may be the workspace override that wins today", () => {
    expect(
      releaseClause(
        known("auto_decide", "system_row", "tenant", "guidance_only"),
        "",
        "o/r",
        "pr_fix"
      )
    ).toContain(
      "If this row is the workspace row that wins today, those repos go back to coord's default (at auto_decide), which can re-arm dispatch for them."
    );
  });

  it("is honest when the default is unread", () => {
    expect(releaseClause({ state: "loading" }, "", "o/r", "pr_fix")).toContain(
      "This can restore a coord system default for those repos (and, if it is auto_decide, re-arm dispatch)."
    );
    // A domain with no dispatch arm never mentions dispatch.
    expect(
      releaseClause({ state: "loading" }, "", "o/r", "architecture_tradeoff")
    ).toBe(
      "Repos other than o/r stop using this row and go back to coord's default, unless another " +
        "workspace row covers them. This can restore a coord system default for those repos."
    );
  });

  it("releases a single repo back to the workspace row or the default", () => {
    expect(
      releaseClause(known("auto_decide", "system_row"), "o/a", "o/b", "pr_fix")
    ).toBe(
      "o/a stops using this row and goes back to another workspace row or coord's default (at auto_decide)."
    );
  });
});

describe("the release clause for a replace that changes the domain", () => {
  const sys = {
    state: "known",
    level: "auto_decide",
    source: "system_row",
    resolvedFrom: "system",
    currentLevel: "auto_decide",
  } as const;

  it("names the old domain, its level, and the re-arm", () => {
    expect(releaseClause(sys, "", "", "pr_fix", true)).toBe(
      "pr_fix loses this row and goes back to another row or coord's default (at auto_decide). " +
        "With coord's system default at auto_decide, this can re-arm dispatch for pr_fix."
    );
  });

  it("names the old repo when the old row was repo-scoped", () => {
    expect(releaseClause(sys, "o/r", "", "pr_fix", true)).toContain(
      "pr_fix for o/r loses this row and goes back to another row or coord's default (at auto_decide)."
    );
  });
});

describe("a priority-only in-place edit", () => {
  const other = {
    name: "frame B",
    autonomy_level: "auto_decide",
    priority: 50,
    created_at: "2026-09-01T00:00:00Z",
    policy_id: "pb",
  };
  const self = (oldPriority: number, newPriority: number) => ({
    name: "frame A",
    autonomy_level: "always_escalate",
    created_at: "2026-09-02T00:00:00Z",
    policy_id: "pa",
    oldPriority,
    newPriority,
  });

  it("says when the row now outranks a row at a different level", () => {
    expect(
      priorityEditCaution({ loaded: true, rows: [other] }, self(100, 10), "o/r")
    ).toBe(
      'This row now ranks above "frame B" (auto_decide) for o/r — consults take this row\'s always_escalate.'
    );
  });

  it("says when the row stops outranking one", () => {
    expect(
      priorityEditCaution({ loaded: true, rows: [other] }, self(10, 100), "")
    ).toBe(
      'This row now ranks below "frame B" (auto_decide) for the workspace — consults take auto_decide ' +
        "instead of this row's always_escalate."
    );
  });

  it("breaks an equal priority by age: the older row keeps winning", () => {
    // frame B is older, so at an equal 50 it still wins: no change from 100.
    expect(
      priorityEditCaution({ loaded: true, rows: [other] }, self(100, 50), "o/r")
    ).toBeNull();
  });

  it("is silent when the winner is unchanged or shares the level", () => {
    expect(
      priorityEditCaution({ loaded: true, rows: [other] }, self(100, 90), "o/r")
    ).toBeNull();
    expect(
      priorityEditCaution(
        {
          loaded: true,
          rows: [{ ...other, autonomy_level: "always_escalate" }],
        },
        self(100, 10),
        "o/r"
      )
    ).toBeNull();
    expect(
      priorityEditCaution({ loaded: true, rows: [] }, self(100, 10), "o/r")
    ).toBeNull();
  });

  it("is UNKNOWN when the rows are not loaded", () => {
    expect(
      priorityEditCaution({ loaded: false }, self(100, 10), "o/r")
    ).toContain("which row wins there is UNKNOWN");
  });
});

describe("ranking stays within one band", () => {
  it("never counts a built-in system row as a competitor when no tenant is known", () => {
    const rows = [
      row({
        policy_id: "seed",
        tenant_id: "system-tenant",
        decision_domain: "admission_stall_fix",
        autonomy_level: "auto_decide",
        built_in: true,
      }),
      row({ policy_id: "t2", decision_domain: "admission_stall_fix" }),
    ];
    const band = sameScopeRows(rows, "admission_stall_fix", "", "t1");
    expect(band.loaded && band.rows.map((r) => r.policy_id)).toEqual(["t2"]);
  });

  it("keeps only the edited row's tenant when that tenant is known", () => {
    const rows = [
      row({ policy_id: "mine", tenant_id: "t1", decision_domain: "pr_fix" }),
      row({ policy_id: "sys", tenant_id: "sys", decision_domain: "pr_fix" }),
    ];
    const band = sameScopeRows(rows, "pr_fix", "", null, "t1");
    expect(band.loaded && band.rows.map((r) => r.policy_id)).toEqual(["mine"]);
    // The system tenant's own rows DO share the seed's band.
    const sysBand = sameScopeRows(rows, "pr_fix", "", null, "sys");
    expect(sysBand.loaded && sysBand.rows.map((r) => r.policy_id)).toEqual([
      "sys",
    ]);
  });
});

describe("coord's in-band tie-break", () => {
  const r = (created_at: string, policy_id: string) => ({
    name: policy_id,
    autonomy_level: "always_escalate",
    priority: 100,
    created_at,
    policy_id,
  });

  it("compares sub-second fractions of different lengths by value", () => {
    // As raw text, "…:00Z" sorts AFTER "…:00.5Z" ('Z' > '.'), and an offset
    // spelling defeats a text compare entirely; by value they order right.
    expect(
      ranksAbove(
        r("2026-09-01T00:00:00Z", "b"),
        r("2026-09-01T00:00:00.5Z", "a")
      )
    ).toBe(true);
    expect(
      ranksAbove(
        r("2026-09-01T02:00:00.1+02:00", "b"),
        r("2026-09-01T00:00:00.05Z", "a")
      )
    ).toBe(false);
    expect(
      ranksAbove(
        r("2026-09-01T00:00:00.45Z", "b"),
        r("2026-09-01T00:00:00.5Z", "a")
      )
    ).toBe(true);
    expect(
      ranksAbove(
        r("2026-09-01T00:00:00.2Z", "a"),
        r("2026-09-01T00:00:00.123456Z", "b")
      )
    ).toBe(false);
    // Microseconds that Date.parse would truncate away still order.
    expect(
      ranksAbove(
        r("2026-09-01T00:00:00.123401Z", "z"),
        r("2026-09-01T00:00:00.123402Z", "a")
      )
    ).toBe(true);
  });

  it("falls back to policy_id ASC on an exact created_at tie", () => {
    expect(
      ranksAbove(
        r("2026-09-01T00:00:00Z", "a"),
        r("2026-09-01T00:00:00.000Z", "b")
      )
    ).toBe(true);
    expect(
      ranksAbove(r("2026-09-01T00:00:00Z", "b"), r("2026-09-01T00:00:00Z", "a"))
    ).toBe(false);
  });
});

describe("a replace that keeps domain and scope", () => {
  const old = {
    name: "frame A",
    autonomy_level: "always_escalate",
    priority: 100,
    created_at: "2026-09-01T00:00:00Z",
    policy_id: "pa",
  };
  const armed = {
    name: "frame B",
    autonomy_level: "auto_decide",
    priority: 100,
    created_at: "2026-09-05T00:00:00Z",
    policy_id: "pb",
  };
  const NOW = "2026-10-14T00:00:00Z";

  it("loses the equal-priority tie the old row won, as the newest row", () => {
    expect(
      replaceRankCaution({ loaded: true, rows: [armed] }, old, 100, "o/r", NOW)
    ).toBe(
      'The replacement is the newest row, so it ranks below "frame B" (auto_decide) for o/r — consults ' +
        "take auto_decide instead of this row's always_escalate."
    );
  });

  it("is silent when the replacement keeps winning on priority", () => {
    expect(
      replaceRankCaution({ loaded: true, rows: [armed] }, old, 10, "o/r", NOW)
    ).toBeNull();
  });

  it("says when a lower priority hands the scope to the replacement", () => {
    const winning = { ...armed, priority: 50 };
    expect(
      replaceRankCaution(
        { loaded: true, rows: [winning] },
        { ...old, priority: 100 },
        10,
        "",
        NOW
      )
    ).toBe(
      'The replacement ranks above "frame B" (auto_decide) for the workspace — consults take the ' +
        "replacement's always_escalate."
    );
  });

  it("is UNKNOWN when the rows are not loaded", () => {
    expect(
      replaceRankCaution({ loaded: false }, old, 100, "o/r", NOW)
    ).toContain("which row wins there is UNKNOWN");
  });
});

describe("the default read once the only workspace row is deleted", () => {
  const tenant = {
    state: "known",
    level: "auto_decide",
    source: "system_row",
    resolvedFrom: "tenant",
    currentLevel: "guidance_only",
  } as const;

  it("reads as the system band when no other workspace row is loaded", () => {
    expect(
      readWithoutDeletedWorkspaceRow(tenant, { loaded: true, rows: [] })
    ).toEqual({
      ...tenant,
      resolvedFrom: "system",
      currentLevel: "auto_decide",
    });
  });

  it("keeps the tenant read when another workspace row exists or the list is unread", () => {
    expect(
      readWithoutDeletedWorkspaceRow(tenant, {
        loaded: true,
        rows: [
          {
            name: "other",
            autonomy_level: "guidance_only",
            priority: 100,
            created_at: "2026-09-01T00:00:00Z",
            policy_id: "o",
          },
        ],
      })
    ).toBe(tenant);
    expect(readWithoutDeletedWorkspaceRow(tenant, { loaded: false })).toBe(
      tenant
    );
  });
});

describe("re-armed dispatch is claimed only where coord can dispatch", () => {
  const known = (level: string, domain: string) =>
    releaseClause(
      {
        state: "known",
        level,
        source: "system_row",
        resolvedFrom: "system",
        currentLevel: level,
      },
      "",
      "o/r",
      domain
    );

  it("architecture_tradeoff at guidance_only restores a frame, never dispatch", () => {
    expect(known("guidance_only", "architecture_tradeoff")).toBe(
      "Repos other than o/r stop using this row and go back to coord's default (at guidance_only), " +
        "unless another workspace row covers them. With coord's system default at guidance_only, this " +
        "restores coord's guidance_only frame for those repos."
    );
  });

  it("next_step at guidance_only restores a frame — guidance_only never dispatches", () => {
    const text = known("guidance_only", "next_step");
    expect(text).toContain(
      "this restores coord's guidance_only frame for those repos."
    );
    expect(text).not.toContain("dispatch");
  });

  it("auto_decide on a domain with no dispatch arm still only restores a frame", () => {
    expect(known("auto_decide", "architecture_tradeoff")).toContain(
      "this restores coord's auto_decide frame for those repos."
    );
  });

  it("auto_decide on a dispatching domain re-arms dispatch", () => {
    expect(known("auto_decide", "next_step")).toContain(
      "this can re-arm dispatch for those repos."
    );
  });
});

describe("telling coord's system row from a tenant's customize-override", () => {
  it("only the system row itself is a system row", () => {
    expect(
      isCoordSystemRow(
        row({ policy_id: "s", built_in: true, system_rule_id: "s" })
      )
    ).toBe(true);
    expect(isCoordSystemRow(row({ policy_id: "s", built_in: true }))).toBe(
      true
    );
    // The override: built_in, customized, pointing at the system row.
    expect(
      isCoordSystemRow(
        row({
          policy_id: "o",
          built_in: true,
          override_state: "customized",
          system_rule_id: "s",
        })
      )
    ).toBe(false);
    expect(isCoordSystemRow(row({ policy_id: "p" }))).toBe(false);
  });

  it("counts a tenant's override row as a same-band competitor in create mode", () => {
    const rows = [
      row({
        policy_id: "o",
        decision_domain: "pr_fix",
        built_in: true,
        override_state: "customized",
        system_rule_id: "s",
      }),
      row({
        policy_id: "s",
        tenant_id: "sys",
        decision_domain: "pr_fix",
        built_in: true,
        system_rule_id: "s",
      }),
    ];
    const band = sameScopeRows(rows, "pr_fix", "", null);
    expect(band.loaded && band.rows.map((r) => r.policy_id)).toEqual(["o"]);
  });
});

describe("a disabled or expired edited row competes with nothing", () => {
  const armed = {
    name: "frame B",
    autonomy_level: "auto_decide",
    priority: 50,
    created_at: "2026-09-01T00:00:00Z",
    policy_id: "pb",
  };

  it("gives no priority caution for a row coord does not serve", () => {
    expect(
      priorityEditCaution(
        { loaded: true, rows: [armed] },
        {
          name: "frame A",
          autonomy_level: "always_escalate",
          created_at: "2026-09-02T00:00:00Z",
          policy_id: "pa",
          oldPriority: 100,
          newPriority: 10,
          live: false,
        },
        "o/r"
      )
    ).toBeNull();
  });

  it("isLiveRow reads enabled and expires_at", () => {
    const now = Date.parse("2026-10-14T00:00:00Z");
    expect(isLiveRow({ enabled: true, expires_at: null }, now)).toBe(true);
    expect(isLiveRow({ enabled: false, expires_at: null }, now)).toBe(false);
    expect(
      isLiveRow({ enabled: true, expires_at: "2026-10-01T00:00:00Z" }, now)
    ).toBe(false);
  });

  it("a replace of a disabled row: the old row ranked nowhere, the (enabled) replacement does", () => {
    const old = {
      name: "frame A",
      autonomy_level: "always_escalate",
      priority: 10,
      created_at: "2026-09-01T00:00:00Z",
      policy_id: "pa",
    };
    const NOW = "2026-10-14T00:00:00Z";
    // Live old row: it already won, the replacement keeps winning — silent.
    expect(
      replaceRankCaution({ loaded: true, rows: [armed] }, old, 10, "o/r", NOW)
    ).toBeNull();
    // Disabled old row: armed was winning, the replacement takes over.
    expect(
      replaceRankCaution(
        { loaded: true, rows: [armed] },
        old,
        10,
        "o/r",
        NOW,
        false
      )
    ).toBe(
      'The replacement ranks above "frame B" (auto_decide) for o/r — consults take the ' +
        "replacement's always_escalate."
    );
  });
});
