/**
 * Model Cost Comparison — calculation helpers
 *
 * Pure functions; no React. Unit-tested in calc.test.ts.
 */

import type {
  Currency,
  CurrencyCode,
  ModelPricing,
  PlanCombination,
  SubscriptionPlan,
} from "./types";

/** Convert a USD amount into the selected currency. */
export function convertUsd(amountUsd: number, currency: Currency): number {
  return amountUsd * currency.perUsd;
}

/**
 * Monthly price of a plan in the selected currency: the officially published
 * local price when the vendor prices per region, else FX conversion.
 */
export function planPrice(plan: SubscriptionPlan, currency: Currency): number {
  const published = plan.publishedPrices?.[currency.code as CurrencyCode];
  return published ?? convertUsd(plan.priceMonthlyUsd, currency);
}

/**
 * Pay-as-you-go API cost for `tokensM` million tokens on a model, split
 * between input and output by `outputShare` (0..1), in the selected currency.
 */
export function apiCost(
  model: ModelPricing,
  tokensM: number,
  outputShare: number,
  currency: Currency
): number {
  const inputM = tokensM * (1 - outputShare);
  const outputM = tokensM * outputShare;
  const usd =
    inputM * model.inputPerMTokUsd + outputM * model.outputPerMTokUsd;
  return convertUsd(usd, currency);
}

/**
 * Cheapest combination of same-family plans whose combined token allotment
 * covers `targetTokensM`. Plans may repeat (you can hold several accounts).
 *
 * Example: plans of 20/100/200 units at $20/$100/$200 and a target of 210
 * yields one 200-plan + one 20-plan.
 *
 * Solved as a min-cost covering problem over units of the smallest common
 * token step; falls back to largest-first greedy if the state space is
 * unreasonably large (it never is for real subscription tiers).
 */
export function cheapestPlanCombination(
  plans: SubscriptionPlan[],
  targetTokensM: number,
  currency: Currency
): PlanCombination | null {
  const usable = plans.filter((p) => p.tokensPerMonthM > 0);
  if (usable.length === 0 || targetTokensM <= 0) return null;

  // Work in integer units: scale so every plan size is integral, then divide
  // by the gcd so 20/100/200 becomes 1/5/10.
  const scale = 100; // token allotments are given to at most 0.01M precision
  const sizes = usable.map((p) => Math.round(p.tokensPerMonthM * scale));
  const unit = sizes.reduce(gcd);
  const planUnits = sizes.map((s) => s / unit);
  const targetUnits = Math.ceil((targetTokensM * scale) / unit);

  const MAX_STATES = 200_000;
  if (targetUnits > MAX_STATES) {
    return greedyCombination(usable, targetTokensM, currency);
  }

  // dp[j] = min cost to cover at least j units; choice[j] = plan index taken.
  const dp = new Float64Array(targetUnits + 1).fill(Infinity);
  const choice = new Int32Array(targetUnits + 1).fill(-1);
  dp[0] = 0;
  for (let j = 1; j <= targetUnits; j++) {
    for (let i = 0; i < usable.length; i++) {
      const plan = usable[i];
      const units = planUnits[i];
      if (plan === undefined || units === undefined) continue;
      const prev = Math.max(0, j - units);
      const cost = (dp[prev] ?? Infinity) + planPrice(plan, currency);
      // Strict < keeps the earliest (largest-first if callers sort) on ties.
      if (cost < (dp[j] ?? Infinity)) {
        dp[j] = cost;
        choice[j] = i;
      }
    }
  }
  if (!isFinite(dp[targetUnits] ?? Infinity)) return null;

  const counts = new Array<number>(usable.length).fill(0);
  for (let j = targetUnits; j > 0; ) {
    const i = choice[j] ?? -1;
    if (i < 0) return null; // unreachable: dp[j] finite implies a choice
    counts[i] = (counts[i] ?? 0) + 1;
    j = Math.max(0, j - (planUnits[i] ?? 0));
  }
  return buildCombination(usable, counts);
}

/** Largest-first greedy fallback: fill with the biggest plan, then top up. */
function greedyCombination(
  plans: SubscriptionPlan[],
  targetTokensM: number,
  currency: Currency
): PlanCombination | null {
  const byTokensDesc = [...plans].sort(
    (a, b) => b.tokensPerMonthM - a.tokensPerMonthM
  );
  const largest = byTokensDesc[0];
  if (largest === undefined) return null;
  const counts = new Array<number>(byTokensDesc.length).fill(0);
  let remaining = targetTokensM;
  while (remaining > largest.tokensPerMonthM) {
    counts[0] = (counts[0] ?? 0) + 1;
    remaining -= largest.tokensPerMonthM;
  }
  // Cheapest single plan that covers the remainder (the largest always can).
  let bestIdx = 0;
  let bestPrice = Infinity;
  byTokensDesc.forEach((p, i) => {
    if (p.tokensPerMonthM >= remaining) {
      const price = planPrice(p, currency);
      if (price < bestPrice) {
        bestPrice = price;
        bestIdx = i;
      }
    }
  });
  counts[bestIdx] = (counts[bestIdx] ?? 0) + 1;
  return buildCombination(byTokensDesc, counts);
}

function buildCombination(
  plans: SubscriptionPlan[],
  counts: number[]
): PlanCombination {
  const items = plans
    .map((plan, i) => ({ plan, count: counts[i] ?? 0 }))
    .filter((it) => it.count > 0)
    .sort((a, b) => b.plan.tokensPerMonthM - a.plan.tokensPerMonthM);
  return {
    items,
    totalTokensM: items.reduce(
      (sum, it) => sum + it.plan.tokensPerMonthM * it.count,
      0
    ),
    totalUsdPerMonth: items.reduce(
      (sum, it) => sum + it.plan.priceMonthlyUsd * it.count,
      0
    ),
  };
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Total cost of a combination in the selected currency (published prices win over FX). */
export function combinationPrice(
  combo: PlanCombination,
  currency: Currency
): number {
  return combo.items.reduce(
    (sum, it) => sum + planPrice(it.plan, currency) * it.count,
    0
  );
}

/** Format an amount in the selected currency, e.g. "$1,234.56". */
export function formatCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.code,
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

/** Human label for a combination, e.g. "1× Max 20x + 1× Pro". */
export function combinationLabel(combo: PlanCombination): string {
  return combo.items.map((it) => `${it.count}× ${it.plan.name}`).join(" + ");
}
