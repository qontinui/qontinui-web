import { describe, it, expect } from "vitest";

import { formatRate } from "./LandPrecisionPanel";

/**
 * Anti-drift guard for the precision/recall null-honesty rule (binding UX
 * priority: honesty about uncertainty). Coord returns precision/recall as
 * `null` when undefined (zero-division — no positive predictions, or no
 * actual positives). The dashboard MUST render "no data yet" for nulls and
 * NEVER fabricate a 0% or 100%. `formatRate` is the single source of that
 * rule; this test pins it.
 */
describe("formatRate — precision/recall null honesty", () => {
  it("null → 'no data yet' (NEVER a fabricated 0%)", () => {
    expect(formatRate(null)).toBe("no data yet");
  });
  it("undefined → 'no data yet'", () => {
    expect(formatRate(undefined)).toBe("no data yet");
  });
  it("NaN → 'no data yet' (defensive)", () => {
    expect(formatRate(Number.NaN)).toBe("no data yet");
  });
  it("a real 0 is a measured 0%, distinct from null", () => {
    expect(formatRate(0)).toBe("0%");
  });
  it("a real 1 is a measured 100%", () => {
    expect(formatRate(1)).toBe("100%");
  });
  it("rounds a fraction to a whole percent", () => {
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(0.833)).toBe("83%");
    expect(formatRate(0.666)).toBe("67%");
  });
});
