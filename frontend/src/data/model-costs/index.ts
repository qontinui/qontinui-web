/**
 * Model Cost Comparison — public module surface
 *
 * Data (data.ts) is admin-entered and refreshed via the /update-model-costs
 * slash command; calculation helpers (calc.ts) are pure and unit-tested.
 */

export * from "./types";
export * from "./calc";
export {
  COMPARISON_DATE,
  CURRENCIES,
  DEFAULT_TOKENS_M,
  DEFAULT_OUTPUT_SHARE,
  MODELS,
  SUBSCRIPTION_PLANS,
} from "./data";

import { CURRENCIES, SUBSCRIPTION_PLANS } from "./data";
import type { Currency, CurrencyCode, SubscriptionPlan } from "./types";

const USD_FALLBACK: Currency = {
  code: "USD",
  symbol: "$",
  name: "US Dollar",
  perUsd: 1,
};

/** Look up a currency by code; falls back to USD. */
export function getCurrency(code: CurrencyCode): Currency {
  return CURRENCIES.find((c) => c.code === code) ?? USD_FALLBACK;
}

/** Subscription plans grouped by combinable family, in dataset order. */
export function getPlanFamilies(): Map<string, SubscriptionPlan[]> {
  const families = new Map<string, SubscriptionPlan[]>();
  for (const plan of SUBSCRIPTION_PLANS) {
    const list = families.get(plan.family) ?? [];
    list.push(plan);
    families.set(plan.family, list);
  }
  return families;
}
