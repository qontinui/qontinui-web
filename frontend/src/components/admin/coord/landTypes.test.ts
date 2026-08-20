import { describe, it, expect } from "vitest";

import { driftClassVariant, type BadgeVariant } from "./landTypes";

/**
 * Anti-drift guard for the cross-repo `worst_drift_class` → badge-variant
 * colour contract.
 *
 * RENAMED from `LandCard.test.ts` in Phase 3 Wave 2, when the ladders moved
 * out of the card into `landTypes.ts`. It also SHRANK: see the note below.
 */
/*
 * The `composedOutcomeVariant` and `dimensionOutcomeVariant` describe blocks
 * that stood here were DELETED in Phase 3 Wave 2, with the functions they
 * covered. They pinned `surprise -> warning (amber)` as "the plan's binding
 * spec" — the exact filing `verificationStatus.ts` deliberately reverses to
 * calm (nothing clears a settled surprise, so amber was a promise it could not
 * keep; R3's third case). Leaving a green test asserting the opposite of the
 * shipped decision is worse than having no test: the next reader cannot tell
 * which one is the contract. The composed-D3 ladder is now audited in
 * `verificationStatus.test.ts` against an attention table.
 */

describe("driftClassVariant — worst_drift_class color ladder", () => {
  it("none → success (verified clean)", () => {
    expect(driftClassVariant("none")).toBe<BadgeVariant>("success");
  });
  it("benign_add → info", () => {
    expect(driftClassVariant("benign_add")).toBe<BadgeVariant>("info");
  });
  it("pending → info", () => {
    expect(driftClassVariant("pending")).toBe<BadgeVariant>("info");
  });
  it("in_place → warning", () => {
    expect(driftClassVariant("in_place")).toBe<BadgeVariant>("warning");
  });
  it("active_negation → destructive", () => {
    expect(driftClassVariant("active_negation")).toBe<BadgeVariant>(
      "destructive"
    );
  });
  it("divergent → destructive", () => {
    expect(driftClassVariant("divergent")).toBe<BadgeVariant>("destructive");
  });
  it("unknown → outline", () => {
    expect(driftClassVariant("unknown")).toBe<BadgeVariant>("outline");
  });
  it("null/undefined/empty → outline (no fabricated color)", () => {
    expect(driftClassVariant(null)).toBe<BadgeVariant>("outline");
    expect(driftClassVariant(undefined)).toBe<BadgeVariant>("outline");
    expect(driftClassVariant("")).toBe<BadgeVariant>("outline");
  });
  it("unrecognized future token → outline (defensive fallback)", () => {
    expect(driftClassVariant("some_new_class")).toBe<BadgeVariant>("outline");
  });
});
