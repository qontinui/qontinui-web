import { describe, it, expect } from "vitest";

import {
  normalizeConfidence,
  confidenceBandWidth,
} from "./LandPreviewPanel";

/**
 * Guards the confidence-interval normalization + band-width derivation that
 * back the "wide band = visibly uncertain" rendering (binding UX priority:
 * honesty about uncertainty). Coord may send a confidence field as a bare
 * number (point estimate) OR a `{ point, lower, upper }` interval; the
 * renderer must treat both uniformly and must not invent a band width for a
 * bare point.
 */
describe("normalizeConfidence — accepts bare number or interval", () => {
  it("null/undefined → all-null", () => {
    expect(normalizeConfidence(null)).toEqual({
      point: null,
      lower: null,
      upper: null,
    });
    expect(normalizeConfidence(undefined)).toEqual({
      point: null,
      lower: null,
      upper: null,
    });
  });
  it("bare number → point only, no bounds", () => {
    expect(normalizeConfidence(0.8)).toEqual({
      point: 0.8,
      lower: null,
      upper: null,
    });
  });
  it("interval object → passes point/lower/upper through", () => {
    expect(
      normalizeConfidence({ point: 0.7, lower: 0.5, upper: 0.9 })
    ).toEqual({ point: 0.7, lower: 0.5, upper: 0.9 });
  });
  it("partial interval → fills missing bounds with null", () => {
    expect(normalizeConfidence({ point: 0.7 })).toEqual({
      point: 0.7,
      lower: null,
      upper: null,
    });
  });
});

describe("confidenceBandWidth — width is the uncertainty", () => {
  it("no bounds (bare point) → null (no width to render)", () => {
    expect(confidenceBandWidth(0.8)).toBeNull();
    expect(confidenceBandWidth({ point: 0.8 })).toBeNull();
    expect(confidenceBandWidth(null)).toBeNull();
  });
  it("a tight interval → a small width", () => {
    expect(confidenceBandWidth({ lower: 0.78, upper: 0.82 })).toBeCloseTo(
      0.04
    );
  });
  it("a wide interval → a large width", () => {
    expect(confidenceBandWidth({ lower: 0.2, upper: 0.9 })).toBeCloseTo(0.7);
  });
  it("clamps to [0,1] for degenerate / inverted bounds", () => {
    expect(confidenceBandWidth({ lower: 0.9, upper: 0.2 })).toBe(0);
    expect(confidenceBandWidth({ lower: -1, upper: 5 })).toBe(1);
  });
});
