import { describe, expect, it } from "vitest";
import {
  estimateVocabulary,
  labourBillingDescription,
  type EstimatePurpose,
} from "./vocabulary";

describe("estimateVocabulary", () => {
  it("gives a budget budget words", () => {
    const v = estimateVocabulary("budget");
    expect(v.noun).toBe("Budget");
    expect(v.actualLabel).toBe("Spent");
    expect(v.differenceLabel).toBe("Remaining");
  });

  it("gives a comparison saving words, and never budget ones", () => {
    const v = estimateVocabulary("comparison");
    expect(v.differenceLabel).toBe("Saving");
    const words =
      `${v.noun} ${v.feeLabel} ${v.totalLabel} ${v.meaning}`.toLowerCase();
    expect(words).not.toContain("budget");
  });

  it("never lets a budget speak of a saving", () => {
    const v = estimateVocabulary("budget");
    const words =
      `${v.noun} ${v.feeLabel} ${v.totalLabel} ${v.differenceLabel} ${v.meaning}`.toLowerCase();
    expect(words).not.toContain("saving");
  });

  it("gives a forecast forecast words and no commitment", () => {
    const v = estimateVocabulary("forecast");
    expect(v.noun).toBe("Forecast");
    expect(v.meaning).toContain("not a commitment");
  });

  it("falls back to the least-promising vocabulary for an unknown purpose", () => {
    for (const value of [null, undefined, "", "somethingelse"]) {
      expect(estimateVocabulary(value as EstimatePurpose | null).purpose).toBe(
        "forecast"
      );
    }
  });

  it("gives every purpose a full, distinct set of labels", () => {
    const purposes: EstimatePurpose[] = ["budget", "comparison", "forecast"];
    const nouns = new Set<string>();
    for (const purpose of purposes) {
      const v = estimateVocabulary(purpose);
      for (const value of [
        v.noun,
        v.nounLower,
        v.feeLabel,
        v.totalLabel,
        v.actualLabel,
        v.differenceLabel,
        v.meaning,
      ]) {
        expect(value.length).toBeGreaterThan(0);
      }
      nouns.add(v.noun);
    }
    expect(nouns.size).toBe(3);
  });
});

describe("labourBillingDescription", () => {
  it("says WHY unbilled labour costs nothing", () => {
    const { label, detail } = labourBillingDescription("unbilled");
    expect(label).toBe("Not billed");
    expect(detail).toContain("comparison only");
  });

  it("distinguishes day rates from a fixed fee", () => {
    expect(labourBillingDescription("day_rates").label).toBe(
      "Billed by day rate"
    );
    expect(labourBillingDescription("fixed_fee").label).toBe(
      "Billed as a fixed fee"
    );
  });

  it("reads an unrecognised setting as not known, never as not billed", () => {
    const { label, detail } = labourBillingDescription("something-new");
    expect(label).toBe("Not known");
    expect(detail).not.toContain("Nobody charges");
  });
});
