import { describe, it, expect } from "vitest";

import {
  composedOutcomeVariant,
  dimensionOutcomeVariant,
  driftClassVariant,
  type BadgeVariant,
} from "./LandCard";

/**
 * Anti-drift guard for the land composed-outcome → badge-variant color
 * contract. Per the plan's binding spec:
 *   confirmed     → green   (success)
 *   surprise      → amber   (warning)
 *   partial       → gray/blue (info)
 *   failure       → red     (destructive)
 *   contradiction → red     (destructive)
 *   unknown/null  → neutral (outline)
 * If this matrix drifts, the operator dashboard's land-outcome colors stop
 * matching the documented taxonomy.
 */
describe("composedOutcomeVariant — composed-outcome color ladder", () => {
  it("confirmed → success (green)", () => {
    expect(composedOutcomeVariant("confirmed")).toBe<BadgeVariant>("success");
  });
  it("surprise → warning (amber)", () => {
    expect(composedOutcomeVariant("surprise")).toBe<BadgeVariant>("warning");
  });
  it("partial → info (gray/blue)", () => {
    expect(composedOutcomeVariant("partial")).toBe<BadgeVariant>("info");
  });
  it("failure → destructive (red)", () => {
    expect(composedOutcomeVariant("failure")).toBe<BadgeVariant>(
      "destructive"
    );
  });
  it("contradiction → destructive (red)", () => {
    expect(composedOutcomeVariant("contradiction")).toBe<BadgeVariant>(
      "destructive"
    );
  });
  it("null/undefined → outline (no fabricated color)", () => {
    expect(composedOutcomeVariant(null)).toBe<BadgeVariant>("outline");
    expect(composedOutcomeVariant(undefined)).toBe<BadgeVariant>("outline");
    expect(composedOutcomeVariant("")).toBe<BadgeVariant>("outline");
  });
  it("unknown future token → outline (defensive fallback)", () => {
    expect(composedOutcomeVariant("some_new_outcome")).toBe<BadgeVariant>(
      "outline"
    );
  });
});

describe("dimensionOutcomeVariant — per-dimension verdict color ladder", () => {
  it("maps the four canonical tokens (case-insensitive)", () => {
    expect(dimensionOutcomeVariant("confirmed")).toBe<BadgeVariant>("success");
    expect(dimensionOutcomeVariant("Surprise")).toBe<BadgeVariant>("warning");
    expect(dimensionOutcomeVariant("PARTIAL")).toBe<BadgeVariant>("info");
    expect(dimensionOutcomeVariant("failure")).toBe<BadgeVariant>(
      "destructive"
    );
    expect(dimensionOutcomeVariant("contradiction")).toBe<BadgeVariant>(
      "destructive"
    );
  });
  it("null/unknown → outline", () => {
    expect(dimensionOutcomeVariant(null)).toBe<BadgeVariant>("outline");
    expect(dimensionOutcomeVariant("weird")).toBe<BadgeVariant>("outline");
  });
});

/**
 * Anti-drift guard for the cross-repo `worst_drift_class` → badge-variant
 * color contract. Coord tokens: none|benign_add|pending|in_place|
 * active_negation|divergent|unknown. If this matrix drifts, the cross-repo
 * restack-verdict colors stop matching coord's taxonomy.
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
