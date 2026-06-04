import { describe, it, expect } from "vitest";

import {
  normalizeConfidence,
  confidenceBandWidth,
} from "./LandPreviewPanel";

/**
 * Guards the confidence-interval normalization + band-width derivation that
 * back the "wide band = visibly uncertain" rendering (binding UX priority:
 * honesty about uncertainty). Coord sends a confidence field as a
 * `{ point, low, high }` interval (the final serde shape); the renderer also
 * accepts a bare number (point estimate) defensively, must treat both
 * uniformly, and must not invent a band width for a bare point.
 */
describe("normalizeConfidence — accepts bare number or {point, low, high} interval", () => {
  it("null/undefined → all-null", () => {
    expect(normalizeConfidence(null)).toEqual({
      point: null,
      low: null,
      high: null,
    });
    expect(normalizeConfidence(undefined)).toEqual({
      point: null,
      low: null,
      high: null,
    });
  });
  it("bare number → point only, no bounds", () => {
    expect(normalizeConfidence(0.8)).toEqual({
      point: 0.8,
      low: null,
      high: null,
    });
  });
  it("interval object → passes point/low/high through", () => {
    expect(
      normalizeConfidence({ point: 0.7, low: 0.5, high: 0.9 })
    ).toEqual({ point: 0.7, low: 0.5, high: 0.9 });
  });
  it("partial interval → fills missing bounds with null", () => {
    expect(normalizeConfidence({ point: 0.7 })).toEqual({
      point: 0.7,
      low: null,
      high: null,
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
    expect(confidenceBandWidth({ low: 0.78, high: 0.82 })).toBeCloseTo(0.04);
  });
  it("a wide interval → a large width", () => {
    expect(confidenceBandWidth({ low: 0.2, high: 0.9 })).toBeCloseTo(0.7);
  });
  it("clamps to [0,1] for degenerate / inverted bounds", () => {
    expect(confidenceBandWidth({ low: 0.9, high: 0.2 })).toBe(0);
    expect(confidenceBandWidth({ low: -1, high: 5 })).toBe(1);
  });
});
