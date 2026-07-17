import { describe, it, expect } from "vitest";

import {
  apiCost,
  cheapestPlanCombination,
  combinationLabel,
  combinationPrice,
  convertUsd,
  planPrice,
} from "./calc";
import type { Currency, ModelPricing, SubscriptionPlan } from "./types";

const USD: Currency = { code: "USD", symbol: "$", name: "US Dollar", perUsd: 1 };
const EUR: Currency = { code: "EUR", symbol: "€", name: "Euro", perUsd: 0.87 };

function plan(
  id: string,
  name: string,
  priceMonthlyUsd: number,
  tokensPerMonthM: number,
  publishedPrices?: SubscriptionPlan["publishedPrices"]
): SubscriptionPlan {
  return {
    id,
    provider: "Test",
    name,
    family: "test-family",
    priceMonthlyUsd,
    publishedPrices,
    tokensPerMonthM,
    tokensEstimated: true,
    models: [],
    source: "test",
  };
}

// The canonical example from the spec: pro=20, max=100, max2=200 token units.
const pro = plan("pro", "Pro", 20, 20);
const max = plan("max", "Max", 100, 100);
const max2 = plan("max2", "Max 20x", 200, 200);
const family = [max2, max, pro];

describe("cheapestPlanCombination", () => {
  it("covers 210 tokens with one Max 20x plus one Pro", () => {
    const combo = cheapestPlanCombination(family, 210, USD);
    expect(combo).not.toBeNull();
    expect(combinationLabel(combo!)).toBe("1× Max 20x + 1× Pro");
    expect(combo!.totalUsdPerMonth).toBe(220);
    expect(combo!.totalTokensM).toBe(220);
  });

  it("uses a single small plan when it suffices", () => {
    const combo = cheapestPlanCombination(family, 10, USD);
    expect(combinationLabel(combo!)).toBe("1× Pro");
    expect(combo!.totalUsdPerMonth).toBe(20);
  });

  it("prefers many small plans when they undercut one big plan", () => {
    // 130 tokens: 1×Max + 2×Pro = $140 beats 1×Max20x = $200.
    const combo = cheapestPlanCombination(family, 130, USD);
    expect(combinationLabel(combo!)).toBe("1× Max + 2× Pro");
    expect(combo!.totalUsdPerMonth).toBe(140);
  });

  it("stacks the largest plan for very large targets", () => {
    const combo = cheapestPlanCombination(family, 410, USD);
    expect(combo!.totalUsdPerMonth).toBe(420); // 2× Max 20x + 1× Pro
    expect(combo!.totalTokensM).toBe(420);
  });

  it("handles an exact fit", () => {
    const combo = cheapestPlanCombination(family, 200, USD);
    expect(combinationLabel(combo!)).toBe("1× Max 20x");
    expect(combo!.totalUsdPerMonth).toBe(200);
  });

  it("ignores plans without quantified tokens and handles empty input", () => {
    const unquantified = plan("mystery", "Mystery", 30, 0);
    expect(cheapestPlanCombination([unquantified], 10, USD)).toBeNull();
    expect(cheapestPlanCombination([], 10, USD)).toBeNull();
    expect(cheapestPlanCombination(family, 0, USD)).toBeNull();
  });

  it("supports fractional token allotments", () => {
    const small = plan("s", "S", 10, 2.5);
    const combo = cheapestPlanCombination([small], 6, USD);
    expect(combo!.items[0].count).toBe(3); // 3 × 2.5 = 7.5 ≥ 6
    expect(combo!.totalUsdPerMonth).toBe(30);
  });
});

describe("currency handling", () => {
  it("converts USD amounts by the FX rate", () => {
    expect(convertUsd(100, EUR)).toBeCloseTo(87);
  });

  it("prefers officially published local prices over FX conversion", () => {
    const p = plan("pro", "Pro", 20, 20, { EUR: 22 });
    expect(planPrice(p, EUR)).toBe(22); // VAT-inclusive published price
    expect(planPrice(p, USD)).toBe(20);
  });

  it("prices combinations with published local prices when available", () => {
    const p = plan("pro", "Pro", 20, 20, { EUR: 22 });
    const combo = cheapestPlanCombination([p], 40, EUR)!;
    expect(combo.items[0].count).toBe(2);
    expect(combinationPrice(combo, EUR)).toBe(44);
    expect(combo.totalUsdPerMonth).toBe(40);
  });
});

describe("apiCost", () => {
  const model: ModelPricing = {
    id: "test-model",
    name: "Test Model",
    provider: "Test",
    inputPerMTokUsd: 5,
    outputPerMTokUsd: 25,
    leaderboards: {},
    source: "test",
    verified: true,
  };

  it("splits tokens between input and output by outputShare", () => {
    // 100M tokens, 25% output: 75 × $5 + 25 × $25 = $1000
    expect(apiCost(model, 100, 0.25, USD)).toBe(1000);
  });

  it("converts to the selected currency", () => {
    expect(apiCost(model, 100, 0.25, EUR)).toBeCloseTo(870);
  });
});
