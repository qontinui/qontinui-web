/**
 * Model Cost Comparison — type definitions
 *
 * The dataset in this directory is admin-entered (checked into the repo) and
 * refreshed on a recurring basis via the /update-model-costs slash command.
 * Users never enter cost data themselves; the page only reads these modules.
 */

/** ISO 4217 currency code, e.g. "USD". */
export type CurrencyCode = "USD" | "EUR" | "GBP" | "JPY";

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  name: string;
  /** How many units of this currency 1 USD buys (mid-market rate on the comparison date). */
  perUsd: number;
}

export interface LeaderboardScores {
  /** LMArena text-arena Elo (arena.ai). */
  lmarenaElo?: number;
  /** Artificial Analysis Intelligence Index (~0-100 composite). */
  aaIntelligenceIndex?: number;
  /** SWE-bench Verified, % of issues resolved. */
  sweBenchVerified?: number;
}

export interface ModelPricing {
  /** API model id, e.g. "claude-opus-4-8". */
  id: string;
  /** Display name, e.g. "Claude Opus 4.8". */
  name: string;
  provider: string;
  /** USD per 1M input tokens (pay-as-you-go API, base tier). */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens. */
  outputPerMTokUsd: number;
  /** USD per 1M cache-read input tokens, when published. */
  cacheReadPerMTokUsd?: number;
  leaderboards: LeaderboardScores;
  /** Where the price was verified (URL). */
  source: string;
  /** False when the number could not be confirmed against an official page. */
  verified: boolean;
  notes?: string;
}

export interface SubscriptionPlan {
  id: string;
  provider: string;
  /** Display name, e.g. "Claude Max 20x". */
  name: string;
  /**
   * Plans in the same family are combinable: one user (or team) can hold
   * several accounts, so 210 units of a 20/100/200 family is served by
   * one 200-plan plus one 20-plan.
   */
  family: string;
  /** Canonical monthly price in USD. */
  priceMonthlyUsd: number;
  /**
   * Officially published local prices, where the vendor prices per region
   * (e.g. EUR incl. VAT). Missing currencies fall back to FX conversion
   * of priceMonthlyUsd.
   */
  publishedPrices?: Partial<Record<CurrencyCode, number>>;
  /** Approximate included usage per month, in millions of tokens. */
  tokensPerMonthM: number;
  /** True when tokensPerMonthM is a community estimate rather than an official figure. */
  tokensEstimated: boolean;
  /** Which models the plan gives access to (display names). */
  models: string[];
  source: string;
  notes?: string;
}

export interface PlanCombinationItem {
  plan: SubscriptionPlan;
  count: number;
}

export interface PlanCombination {
  items: PlanCombinationItem[];
  /** Total included tokens across the combination, millions. */
  totalTokensM: number;
  totalUsdPerMonth: number;
}
