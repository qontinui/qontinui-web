/**
 * verificationStatus — the composed-D3 derivation shared by `/admin/coord/lands`
 * and `/admin/coord/deploys`, and its R3 audit.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 2. Pure, no DOM; the palette agreement is asserted through the SHARED
 * `paletteDisagreements` rather than a private copy (style guide §4.2 clause 3).
 *
 * The colour ladder this replaces was `composedOutcomeVariant` in `LandCard`,
 * whose own test (now `landTypes.test.ts`) still pins the `BadgeVariant`
 * mapping for the two places that still use it — the cross-repo drift badges.
 * What that ladder never had, and what this file is mostly about, is a
 * SEVERITY model behind the colours.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  OWED_REVIEW,
  VERIFICATION_ATTENTION_BY_KIND,
  VERIFICATION_AUTHOR_GLYPH_KINDS,
  VERIFICATION_CLASS,
  VERIFICATION_LABEL,
  classifyComposedOutcome,
  deriveVerificationStatus,
  type VerificationKind,
} from "./verificationStatus";

const ALL_KINDS: VerificationKind[] = [
  "confirmed",
  "partial",
  "surprise",
  "failure",
  "contradiction",
  "unverified",
  "unknown",
];

describe("VERIFICATION_ATTENTION_BY_KIND — the R3 audit table", () => {
  it("is total over the kind union, with a class and a label for every kind", () => {
    expect(Object.keys(VERIFICATION_ATTENTION_BY_KIND).sort()).toEqual(
      [...ALL_KINDS].sort()
    );
    for (const k of ALL_KINDS) {
      expect(VERIFICATION_CLASS[k], `${k} has no badge class`).toBeTruthy();
      expect(VERIFICATION_LABEL[k], `${k} has no label`).toBeTruthy();
      expect(k in OWED_REVIEW, `${k} missing from OWED_REVIEW`).toBe(true);
    }
  });

  it("agrees with the palette — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(VERIFICATION_ATTENTION_BY_KIND, {
        badgeClass: VERIFICATION_CLASS,
        authorGlyphKinds: VERIFICATION_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("pins the four calls a future kind is most likely to copy wrongly", () => {
    // `paletteDisagreements` proves the hue matches the DECLARED attention and
    // can never prove the declared attention was the right one (§4.2 clause 4).
    //
    // `failure` / `contradiction`: the action did not do what it declared, or
    // the observations cannot all be true. Nothing retries, nothing times out.
    expect(VERIFICATION_ATTENTION_BY_KIND.failure).toBe("author");
    expect(VERIFICATION_ATTENTION_BY_KIND.contradiction).toBe("author");
    // `unverified`: the verifier is the named thing that clears it, shortly,
    // on its own. Amber's self-clearing contract, satisfied literally.
    expect(VERIFICATION_ATTENTION_BY_KIND.unverified).toBe("waiting");
    // `surprise`: CALM, not amber. Nothing clears a settled surprise — it is
    // an observation that the effect differed from the prediction — and
    // nothing is blocked while it waits. R3's third case: the ask goes in the
    // detail, in words, which is what OWED_REVIEW carries.
    expect(VERIFICATION_ATTENTION_BY_KIND.surprise).toBe("none");
    expect(VERIFICATION_CLASS.surprise).not.toMatch(/bg-amber-/);
  });

  it("makes every calm-but-OWED kind state its ask in words (§4.2 clause 4)", () => {
    // The half of the contract no palette audit can check. A kind declared
    // `none` that nonetheless owes somebody a decision MUST carry the
    // sentence; a kind that owes nothing must not invent one.
    expect(OWED_REVIEW.surprise).toBeTruthy();
    expect(OWED_REVIEW.partial).toBeTruthy();
    for (const k of ["confirmed", "failure", "contradiction", "unverified", "unknown"] as const) {
      expect(OWED_REVIEW[k], `${k} claims something is owed`).toBeNull();
    }
    // And the ask has to be an ASK, not a restatement of the status.
    expect(OWED_REVIEW.surprise).toMatch(/^Owed: /);
    expect(OWED_REVIEW.partial).toMatch(/^Owed: /);
  });

  it("floors an unreadable verdict at amber, never at calm", () => {
    // R3's ignorance exception. The card ladder painted this `outline` grey,
    // which asserts "nothing is wrong here" about a verdict we could not read.
    expect(VERIFICATION_ATTENTION_BY_KIND.unknown).toBe("waiting");
    expect(VERIFICATION_CLASS.unknown).toMatch(/bg-amber-/);
  });
});

describe("classifyComposedOutcome", () => {
  it("recognises coord's wire vocabulary, case-insensitively", () => {
    expect(classifyComposedOutcome("confirmed")).toBe("confirmed");
    expect(classifyComposedOutcome("CONTRADICTION")).toBe("contradiction");
    expect(classifyComposedOutcome(" partial ")).toBe("partial");
  });

  it("degrades an unseen or absent outcome to unknown rather than throwing", () => {
    expect(classifyComposedOutcome("brand_new_outcome_2027")).toBe("unknown");
    expect(classifyComposedOutcome(null)).toBe("unknown");
    expect(classifyComposedOutcome("")).toBe("unknown");
  });

  it("does not classify a prototype key as a known outcome", () => {
    // The bug an `in` test against VERIFICATION_LABEL would have shipped.
    expect(classifyComposedOutcome("constructor")).toBe("unknown");
    expect(classifyComposedOutcome("toString")).toBe("unknown");
  });
});

describe("deriveVerificationStatus", () => {
  it("distinguishes 'not yet verified' from 'we cannot read the verdict'", () => {
    // Two different states that a single neutral badge used to collapse.
    const none = deriveVerificationStatus(null);
    expect(none.kind).toBe("unverified");
    expect(none.reason).toBe("declared, waiting on the verifier");

    const unreadable = deriveVerificationStatus({ composed_outcome: "??" });
    expect(unreadable.kind).toBe("unknown");
    // Verbatim, never guessed at.
    expect(unreadable.label).toBe("??");
  });

  it("summarises coverage and dimension counts as the row's why", () => {
    const s = deriveVerificationStatus({
      composed_outcome: "partial",
      coverage: 0.75,
      dimensions_observed: 3,
      dimensions_predicted: 4,
      settled: true,
    });
    expect(s.reason).toBe("75% coverage, 3/4 dims");
  });

  it("reports a ZERO coverage rather than dropping to the rationale", () => {
    // `0` is a measurement — "we looked, nothing was covered" — and a
    // falsy-check would swallow it and show the rationale instead.
    const s = deriveVerificationStatus({
      composed_outcome: "partial",
      coverage: 0,
      rationale: "should not be shown",
    });
    expect(s.reason).toBe("0% coverage");
  });

  it("says a verdict is still settling, because it can still change", () => {
    const s = deriveVerificationStatus({
      composed_outcome: "confirmed",
      settled: false,
    });
    expect(s.reason).toBe("still settling");
  });

  it("falls back to coord's rationale when it has no numbers at all", () => {
    const s = deriveVerificationStatus({
      composed_outcome: "confirmed",
      rationale: "all six dimensions agreed",
    });
    expect(s.reason).toBe("all six dimensions agreed");
  });

  it("leaves the reason undefined rather than fabricating one", () => {
    expect(
      deriveVerificationStatus({ composed_outcome: "confirmed" }).reason
    ).toBeUndefined();
  });
});
