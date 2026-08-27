/**
 * R3's audit for the onboarding-claim banner palette.
 *
 * The shared `paletteDisagreements` proves the hue matches the DECLARED
 * attention. It cannot prove the declared attention was right — §4.2 clause 4
 * — so the second test pins the one judgement this module makes: `recover` is
 * an author-action state, not an in-progress one.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  AUTHOR_RED,
  rowAccentClass,
} from "@/components/console/statusRow";
import {
  CLAIM_ATTENTION_BY_PHASE,
  CLAIM_AUTHOR_GLYPH_PHASES,
  CLAIM_PHASE_CLASS,
  claimBannerBorder,
  deriveClaimStatus,
  type ClaimPhase,
} from "./onboardingClaimStatus";

const ALL: ClaimPhase[] = ["claiming", "success", "error", "recover"];

describe("onboarding claim palette", () => {
  it("agrees with the attention table — red iff author, ✕ iff red", () => {
    expect(
      paletteDisagreements(CLAIM_ATTENTION_BY_PHASE, {
        badgeClass: CLAIM_PHASE_CLASS,
        authorGlyphKinds: CLAIM_AUTHOR_GLYPH_PHASES,
      })
    ).toEqual([]);
  });

  it("is total over the phase union in every direction", () => {
    for (const p of ALL) {
      expect(CLAIM_ATTENTION_BY_PHASE[p]).toBeDefined();
      expect(CLAIM_PHASE_CLASS[p]).toBeTruthy();
      expect(claimBannerBorder(p)).toBeTruthy();
      expect(deriveClaimStatus(p).kind).toBe(p);
    }
    expect(Object.keys(CLAIM_ATTENTION_BY_PHASE).sort()).toEqual(
      [...ALL].sort()
    );
  });

  it("files `recover` as author-action, and says why in the row", () => {
    // The correction this module records: a stateless callback needs a HUMAN
    // to start the connect again. Nothing retries it, so it is neither calm
    // (which would understate a dead end) nor amber (whose contract is that
    // something else clears it).
    expect(CLAIM_ATTENTION_BY_PHASE.recover).toBe("author");
    expect(deriveClaimStatus("recover").reason).toMatch(/nothing will retry/i);
  });

  it("derives the banner chrome from attention, never from a second table", () => {
    // The banner used to be a hand-written Record that re-spelled
    // `rowAccentClass`'s output and picked a THIRD red tint (`/40`, against
    // AUTHOR_RED's `/35`) — drift `paletteDisagreements` cannot see, because
    // it never saw this constant at all. Two assertions make the doc's claim
    // ("keyed off the phase's attention") true rather than merely stated:
    for (const p of ALL) {
      const attention = CLAIM_ATTENTION_BY_PHASE[p];
      // 1. The accent is the SHARED function's output, byte for byte.
      expect(claimBannerBorder(p)).toContain(rowAccentClass({ attention }));
      // 2. An author phase's ring tint is the one AUTHOR_RED already carries.
      if (attention === "author") {
        expect(AUTHOR_RED).toContain("border-red-500/35");
        expect(claimBannerBorder(p)).toContain("border-red-500/35");
      } else {
        expect(claimBannerBorder(p)).not.toContain("red");
      }
    }
  });

  it("keeps the in-flight phase calm", () => {
    // The mirror clause: a spinner is not an alarm. Painting `claiming` red
    // would be the exact bug R3 exists to prevent.
    expect(CLAIM_ATTENTION_BY_PHASE.claiming).toBe("none");
    expect(/\bbg-red-/.test(CLAIM_PHASE_CLASS.claiming)).toBe(false);
  });
});
