import { describe, it, expect } from "vitest";

import {
  composedOutcomeVariant,
  dimensionOutcomeVariant,
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
