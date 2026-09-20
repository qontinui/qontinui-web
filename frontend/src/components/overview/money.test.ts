import { describe, expect, it } from "vitest";
import {
  formatDecimal,
  formatMicros,
  formatMicrosRange,
  microsToAmountInput,
  parseAmountToMicros,
  toNumber,
} from "./money";

describe("formatMicros", () => {
  it("reads micros as millionths of a currency unit", () => {
    expect(formatMicros(19_280_000, "USD", { maximumFractionDigits: 2 })).toBe(
      "$19.28"
    );
    expect(formatMicros(900_000_000, "EUR")).toContain("900");
  });

  it("returns null for an absent figure rather than a zero", () => {
    expect(formatMicros(null, "EUR")).toBeNull();
    expect(formatMicros(undefined, "EUR")).toBeNull();
    // A real zero is still a zero.
    expect(formatMicros(0, "EUR")).not.toBeNull();
  });

  it("still shows the number when the currency code is not a known one", () => {
    const text = formatMicros(1_000_000, "XYZ");
    expect(text).toContain("1");
    expect(text).toContain("XYZ");
  });

  it("formats with no currency at all", () => {
    expect(formatMicros(1_500_000, null)).toBe("2");
    expect(formatMicros(1_500_000, null, { maximumFractionDigits: 2 })).toBe(
      "1.5"
    );
  });
});

describe("formatMicrosRange", () => {
  it("shows a band", () => {
    expect(formatMicrosRange(1_000_000, 2_000_000, "EUR")).toContain("–");
  });

  it("shows one figure when the ends agree or the high is absent", () => {
    expect(formatMicrosRange(1_000_000, 1_000_000, "EUR")).not.toContain("–");
    expect(formatMicrosRange(1_000_000, null, "EUR")).not.toContain("–");
  });

  it("is null when there is no low end", () => {
    expect(formatMicrosRange(null, 2_000_000, "EUR")).toBeNull();
  });
});

describe("toNumber / formatDecimal", () => {
  it("reads the wire's decimal strings", () => {
    expect(toNumber("240.00")).toBe(240);
    expect(formatDecimal("240.00")).toBe("240");
    expect(formatDecimal("9.18")).toBe("9.18");
    expect(formatDecimal("4.500", 3)).toBe("4.5");
  });

  it("never turns an absent value into zero", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("not a number")).toBeNull();
    expect(formatDecimal(null)).toBeNull();
  });

  it("keeps a genuine zero", () => {
    expect(toNumber("0")).toBe(0);
    expect(formatDecimal("0.00")).toBe("0");
  });
});

describe("parseAmountToMicros", () => {
  it("reads what a person types", () => {
    expect(parseAmountToMicros("900")).toBe(900_000_000);
    expect(parseAmountToMicros("1,250.50")).toBe(1_250_500_000);
    expect(parseAmountToMicros(" 12.34 ")).toBe(12_340_000);
  });

  it("is null for anything it cannot read, including empty", () => {
    expect(parseAmountToMicros("")).toBeNull();
    expect(parseAmountToMicros("nine hundred")).toBeNull();
    expect(parseAmountToMicros("1.2.3")).toBeNull();
  });

  it("round-trips through the editable form", () => {
    expect(microsToAmountInput(parseAmountToMicros("1250.5"))).toBe("1250.5");
    expect(microsToAmountInput(null)).toBe("");
  });
});
