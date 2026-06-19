import { describe, expect, it } from "vitest";

import { formatRatio } from "./status-presentation";

describe("formatRatio", () => {
  it("formats a ratio as a rounded percentage", () => {
    expect(formatRatio(0.9)).toBe("90%");
    expect(formatRatio(1)).toBe("100%");
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(0.954)).toBe("95%");
  });

  it("renders an em-dash for null / undefined", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(undefined)).toBe("—");
  });

  it("renders an em-dash for NaN (the prod Auth-credibility bug)", () => {
    // A coord verdict can carry a non-numeric credibility; it must not render
    // as "NaN%" — observed live on the Auth sub-space cell.
    expect(formatRatio(NaN)).toBe("—");
  });
});
