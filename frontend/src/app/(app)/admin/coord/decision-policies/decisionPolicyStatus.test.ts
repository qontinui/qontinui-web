/**
 * The surface's own R3 oracle. `components/console/attention.test.ts` audits
 * the palette against the same table across every console surface at once;
 * this file pins the DERIVATION — which row lands on which kind — and the
 * things only this surface knows.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import {
  DECISION_POLICY_ATTENTION_BY_KIND,
  DECISION_POLICY_AUTHOR_GLYPH_KINDS,
  DECISION_POLICY_CLASS,
  deriveDecisionPolicyStatus,
  rowMode,
  rowPayloadWarnings,
} from "./decisionPolicyStatus";

const NOW = Date.parse("2026-09-06T12:00:00Z");

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

describe("the R3 table", () => {
  it("agrees with the palette", () => {
    expect(
      paletteDisagreements(DECISION_POLICY_ATTENTION_BY_KIND, {
        badgeClass: DECISION_POLICY_CLASS,
        authorGlyphKinds: DECISION_POLICY_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("reserves `author` for the one kind a human must fix", () => {
    // Spelled out rather than derived: `always_escalate` is the state coord
    // PUTS every new row in, and painting it red would train the eye to ignore
    // red on the page whose whole point is that creating a row is safe.
    expect(DECISION_POLICY_ATTENTION_BY_KIND).toEqual({
      escalating: "none",
      framing: "none",
      acting: "none",
      disabled: "none",
      expired: "none",
      misconfigured: "author",
      unknown: "waiting",
    });
  });
});

describe("deriveDecisionPolicyStatus", () => {
  it("calls a clean always_escalate row inert, not broken", () => {
    const s = deriveDecisionPolicyStatus(row(), NOW);
    expect(s.kind).toBe("escalating");
    expect(s.attention).toBe("none");
    expect(s.reason).toContain("Escalate");
  });

  it("distinguishes guidance_only from auto_decide", () => {
    expect(
      deriveDecisionPolicyStatus(row({ autonomy_level: "guidance_only" }), NOW)
        .kind
    ).toBe("framing");
    expect(
      deriveDecisionPolicyStatus(row({ autonomy_level: "auto_decide" }), NOW)
        .kind
    ).toBe("acting");
  });

  it("treats disabled and expired as a choice, ahead of any payload defect", () => {
    const bad = { rubric: 7 };
    expect(
      deriveDecisionPolicyStatus(row({ enabled: false, payload: bad }), NOW).kind
    ).toBe("disabled");
    expect(
      deriveDecisionPolicyStatus(
        row({ expires_at: "2026-09-05T00:00:00Z", payload: bad }),
        NOW
      ).kind
    ).toBe("expired");
    // An expiry in the future is not an expiry.
    expect(
      deriveDecisionPolicyStatus(
        row({ expires_at: "2026-12-25T00:00:00Z" }),
        NOW
      ).kind
    ).toBe("escalating");
  });

  it("calls a row whose payload coord would drop `misconfigured`", () => {
    const s = deriveDecisionPolicyStatus(
      row({ autonomy_level: "auto_decide", payload: { rubric: {} } }),
      NOW
    );
    expect(s.kind).toBe("misconfigured");
    expect(s.attention).toBe("author");
    expect(s.reason).toContain("drops 1 payload field");
  });

  it("is UNKNOWN — amber — for a mode or level this build cannot read", () => {
    const badMode = deriveDecisionPolicyStatus(
      row({ mode: "deterministic" }),
      NOW
    );
    expect(badMode.kind).toBe("unknown");
    expect(badMode.attention).toBe("waiting");

    const badLevel = deriveDecisionPolicyStatus(
      row({ autonomy_level: "shadow" }),
      NOW
    );
    expect(badLevel.kind).toBe("unknown");
    expect(badLevel.attention).toBe("waiting");
  });
});

describe("row helpers", () => {
  it("reads the two v2 modes and rejects the v1 one", () => {
    expect(rowMode(row({ mode: "guidance" }))).toBe("guidance");
    expect(rowMode(row({ mode: "data_driven" }))).toBe("data_driven");
    expect(rowMode(row({ mode: "deterministic" }))).toBeNull();
  });

  it("returns null warnings — UNKNOWN — when the mode is unreadable", () => {
    expect(rowPayloadWarnings(row({ mode: "deterministic" }))).toBeNull();
  });

  it("treats a null payload as an empty object, not as a defect", () => {
    expect(rowPayloadWarnings(row({ payload: null }))).toEqual([]);
  });

  it("reports a stored non-object payload as a defect this form could not have written", () => {
    const warnings = rowPayloadWarnings(row({ payload: [1, 2, 3] }));
    expect(warnings).toHaveLength(1);
    expect(warnings?.[0]).toContain("must be a JSON object");
  });
});
