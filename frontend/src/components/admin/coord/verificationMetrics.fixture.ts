/**
 * Test fixtures shaped exactly like coord's `metrics_response` /
 * `degraded_metrics_body` (qontinui-coord 3088dc5d). Imported by tests only.
 */

import type {
  DegradedMetrics,
  PopulatedMetrics,
  SeriesWeek,
  VerificationLane,
} from "./verificationMetrics";

export const NOW = Date.parse("2026-09-30T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

export function freshLane(
  overrides: Partial<VerificationLane> = {}
): VerificationLane {
  return {
    last_verdict_at: hoursAgo(3),
    last_cycle_outcome: "ok",
    last_cycle_reason: null,
    last_cycle_at: hoursAgo(3),
    canary: "pass",
    canary_at: hoursAgo(3),
    installed: true,
    installed_basis: "a lane journal head 3h old (fresh window 48h)",
    journal_finding_id: "0f3c1e0e-0000-4000-8000-000000000001",
    ...overrides,
  };
}

function week(i: number, n: number): SeriesWeek {
  const start = new Date(NOW - (12 - i) * 7 * 86400_000).toISOString();
  const end = new Date(NOW - (11 - i) * 7 * 86400_000).toISOString();
  return {
    week_start: start,
    week_end: end,
    throughput: 13,
    n,
    trust_calibration:
      n === 0
        ? {
            value: null,
            ci95_low: null,
            ci95_high: null,
            survived: 0,
            refuted: 0,
            n: 0,
            population: 13,
            method: "wilson+fpc",
            reason: "no verdicts in window",
          }
        : {
            value: 0.8,
            ci95_low: 0.6,
            ci95_high: 0.93,
            survived: 4,
            refuted: 1,
            n: 5,
            population: 13,
            method: "wilson+fpc",
            reason: null,
          },
    independent_verification_coverage: {
      value: n / 13,
      verified_disjoint: n,
      population: 13,
      reason: null,
    },
  };
}

export function populated(
  overrides: Partial<PopulatedMetrics> = {}
): PopulatedMetrics {
  return {
    degraded: false,
    generated_at: hoursAgo(0),
    window: { days: 28, from: hoursAgo(28 * 24), to: hoursAgo(0) },
    population_query_id: "work_unit_verification::SHIPPED_POPULATION_SQL",
    population: 52,
    trust_calibration: {
      value: 0.912,
      ci95_low: 0.841,
      ci95_high: 0.953,
      survived: 18,
      refuted: 2,
      n: 20,
      population: 52,
      method: "wilson+fpc",
      reason: null,
      counts:
        "standing verdicts whose author_resolution is disjoint; unverifiable excluded",
    },
    independent_verification_coverage: {
      value: 0.38,
      verified_disjoint: 20,
      population: 52,
      reason: null,
    },
    unknowns: {
      unverifiable_by_reason: { no_stated_criteria: 9, surface_unreachable: 3 },
      independence_unproven: 3,
      claims_unreadable: {
        count: 1,
        examined: 9,
        of: 9,
        complete: true,
        first: ["x (no_citations)"],
      },
      selected_not_yet_verified: 9,
      selected_not_yet_verified_reason: null,
      oldest_unverified_age_secs: 3 * 86400,
      recheck_pending: 0,
      recheck_unreadable: 0,
    },
    pre_land_review: {
      units_with_reviewed_head_for_landed_sha: 30,
      population: 52,
      note: "author-written evidence, reported beside coverage and never counted in it",
    },
    sampling: {
      configured_rate_bp: 4000,
      effective_rate_bp: 10000,
      rate_source: "default",
      surge_reason: "a refutation 2 day(s) old",
      calibration_floor_bp: 8500,
      floor_source: "default",
    },
    lane: freshLane(),
    series: Array.from({ length: 12 }, (_, i) => week(i, i < 2 ? 0 : 5)),
    ...overrides,
  };
}

export function noVerifications(): PopulatedMetrics {
  return populated({
    trust_calibration: {
      value: null,
      ci95_low: null,
      ci95_high: null,
      survived: 0,
      refuted: 0,
      n: 0,
      population: 52,
      method: "wilson+fpc",
      reason: "no verdicts in window",
    },
    independent_verification_coverage: {
      value: 0,
      verified_disjoint: 0,
      population: 52,
      reason: null,
    },
    lane: freshLane({
      last_verdict_at: null,
      last_cycle_outcome: "queue_empty",
    }),
  });
}

export function degraded(): DegradedMetrics {
  return {
    degraded: true,
    reason:
      "coord.work_unit_verifications is absent (migration wuverif_01 not applied)",
    generated_at: hoursAgo(0),
    window: { days: 28, from: hoursAgo(28 * 24), to: hoursAgo(0) },
    population_query_id: "work_unit_verification::SHIPPED_POPULATION_SQL",
    population: null,
    trust_calibration: null,
    independent_verification_coverage: null,
    unknowns: null,
    pre_land_review: null,
    sampling: {
      configured_rate_bp: 4000,
      effective_rate_bp: null,
      rate_source: "default",
      surge_reason: null,
      calibration_floor_bp: 8500,
      floor_source: "default",
    },
    lane: freshLane({
      last_verdict_at: null,
      installed: "unknown",
      installed_basis: "the verdict store is unreadable",
    }),
    series: null,
    note: "coord could NOT look — these are not zeros.",
  };
}

export const REFUTATION_FINDING = {
  finding_id: "7a1b2c3d-0000-4000-8000-00000000abcd",
  topic: "verification-refuted",
  title:
    "Independent verification REFUTED shipped unit 2026-09-01-widget-export — 2 unmet criterion(s)",
  body: 'A fresh-context verifier checked work unit `2026-09-01-widget-export` ("Widgets export to CSV") against origin/main and the deployed surface and found its "landed and verified" claim did not hold.',
  created_at: hoursAgo(48),
};
