/**
 * R3's audit for the tenant-autonomy palette, plus the judgement
 * `paletteDisagreements` cannot make (style guide §4.2 clause 4).
 *
 * The judgement here is that `inert` — a tenant that opted in while the
 * platform master flag is off — is CALM rather than amber, and pays for that
 * by saying the ask in words. Pinned because "the opt-in is not working, that
 * must be amber" is the exact reach R3's third case exists to stop.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  derivePolicyAutonomyStatus,
  INERT_EXPLANATION,
  POLICY_ATTENTION_BY_KIND,
  POLICY_AUTHOR_GLYPH_KINDS,
  POLICY_KIND_CLASS,
  type PolicyAutonomyKind,
} from "./policyAutonomyStatus";

const ALL: PolicyAutonomyKind[] = [
  "dispatching",
  "guidance",
  "escalating",
  "inert",
];

describe("tenant-autonomy palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(POLICY_ATTENTION_BY_KIND, {
        badgeClass: POLICY_KIND_CLASS,
        authorGlyphKinds: POLICY_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    expect(Object.keys(POLICY_ATTENTION_BY_KIND).sort()).toEqual(
      [...ALL].sort()
    );
    for (const k of ALL) expect(POLICY_KIND_CLASS[k]).toBeTruthy();
  });

  it("mints no red and no amber — nothing here is anybody's move", () => {
    for (const k of ALL) {
      expect(/\bbg-red-/.test(POLICY_KIND_CLASS[k])).toBe(false);
      expect(/\bbg-amber-/.test(POLICY_KIND_CLASS[k])).toBe(false);
    }
    expect(POLICY_AUTHOR_GLYPH_KINDS.size).toBe(0);
  });
});

describe("the CALM-but-owed reading the palette audit cannot make", () => {
  it("files an opted-in tenant with the master flag off as CALM, said in words", () => {
    const s = derivePolicyAutonomyStatus({
      autonomy_level: "auto_decide",
      effective: false,
    });
    expect(s.kind).toBe("inert");
    expect(s.attention).toBe("none");
    // R3's third case: the ask is in the detail, never borrowed from amber.
    expect(s.reason).toBe(INERT_EXPLANATION);
    expect(s.reason).toMatch(/master flag/);
  });

  it("applies the same reading to guidance_only", () => {
    expect(
      derivePolicyAutonomyStatus({
        autonomy_level: "guidance_only",
        effective: false,
      }).kind
    ).toBe("inert");
  });

  it("never calls a DEFAULT tenant's non-effectiveness an inert opt-in", () => {
    // `always_escalate` opted into nothing, so there is no opt-in for the
    // master flag to switch off. Saying "opt-in not in effect" here would be
    // a sentence about an opt-in that does not exist.
    const s = derivePolicyAutonomyStatus({
      autonomy_level: "always_escalate",
      effective: false,
    });
    expect(s.kind).toBe("escalating");
    expect(s.reason).toBeUndefined();
  });

  it("names the two working states and owes them no explanation", () => {
    const auto = derivePolicyAutonomyStatus({
      autonomy_level: "auto_decide",
      effective: true,
    });
    expect(auto.kind).toBe("dispatching");
    expect(auto.reason).toBeUndefined();

    expect(
      derivePolicyAutonomyStatus({
        autonomy_level: "guidance_only",
        effective: true,
      }).kind
    ).toBe("guidance");
  });

  it("falls back to coord's own default for a level outside the enum", () => {
    // Not an `unknown` kind that never renders — coord escalates when it does
    // not recognise a level, so that is what the row says.
    expect(
      derivePolicyAutonomyStatus({
        autonomy_level: "something_new",
        effective: true,
      }).kind
    ).toBe("escalating");
  });
});
