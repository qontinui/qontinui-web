/**
 * Builders for `kpis/v1` bodies — the frozen contract's shapes, with every
 * figure overridable, so a test states only what it is about.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. Defaults are a unit
 * with every figure KNOWN and fully covered; a test that wants UNKNOWN or
 * partial coverage overrides that one figure with {@link unknown} /
 * {@link kpi}.
 */

import type {
  Kpi,
  KpiUnit,
  KpisAggregates,
  KpisPayload,
} from "@/components/admin/coord/kpisV1";

/** A known figure. Coverage defaults to full (1 of 1). */
export function kpi(
  value: number,
  over: Partial<Omit<Kpi<number>, "value">> = {}
): Kpi<number> {
  return {
    value,
    coverage_n: 1,
    population_n: 1,
    basis: "cited PRs of the unit",
    reason: null,
    ...over,
  };
}

/** An UNKNOWN figure: `value` null and a reason, as the contract requires. */
export function unknown(
  reason: string,
  over: Partial<Omit<Kpi<number>, "value" | "reason">> = {}
): Kpi<number> {
  return {
    value: null,
    coverage_n: 0,
    population_n: 3,
    basis: "sessions of the unit with a usage row",
    reason,
    ...over,
  };
}

/** A unit with every figure known. Pass `over` to change any of them. */
export function unit(slug: string, over: Partial<KpiUnit> = {}): KpiUnit {
  return {
    slug,
    work_unit_id: "5d3c1d9e-0000-4000-8000-000000000001",
    status: "shipped",
    shipped_at: "2026-10-03T08:00:00Z",
    lead_time_seconds: kpi(5400, {
      basis: "first in_progress to last cited PR landed",
    }),
    lead_time_segments: {
      in_progress_to_first_pr_opened_seconds: kpi(1800),
      first_pr_opened_to_last_landed_seconds: kpi(3600),
    },
    sessions: kpi(3, { coverage_n: 3, population_n: 3, basis: "sessions" }),
    tokens: {
      input: kpi(12_345, { basis: "sessions with a usage row" }),
      output: kpi(4_100, { basis: "sessions with a usage row" }),
      cache_creation_input: kpi(900),
      cache_read_input: kpi(250_000),
    },
    cost_microusd: kpi(2_500_000, {
      basis: "list-price equivalent; 2 reported, 1 estimated",
    }),
    ci_attempts: kpi(4),
    red_to_green_iterations: kpi(1),
    interventions: kpi(2, { basis: "operator-reaching touches" }),
    interventions_split: {
      policy_authorized_true: 1,
      policy_authorized_false: 0,
      policy_authorized_unknown: 1,
    },
    rework: kpi(0, { basis: "cited PRs reverted within 14 days" }),
    prs: { cited: 2, landed: 2 },
    ...over,
  };
}

function aggregates(): KpisAggregates {
  return {
    lead_time_seconds_median: kpi(5400, { coverage_n: 3, population_n: 3 }),
    lead_time_seconds_p90: kpi(9000, { coverage_n: 3, population_n: 3 }),
    autonomy_rate: unknown("not_yet_measured"),
    cost_per_shipped_task_microusd_median: kpi(2_500_000, {
      basis: "list-price equivalent",
    }),
    land_rate: kpi(0.75),
    red_to_green_per_pr_median: kpi(1),
    rework_rate: unknown("revert_probe_not_run"),
  };
}

/**
 * The aggregates block of a single-unit `slug=` read: coord does not recompute
 * the population, so every aggregate is UNKNOWN with `not_requested`, over the
 * window's full shipped count.
 */
export function notRequestedAggregates(populationN: number): KpisAggregates {
  const one = (): Kpi<number> => ({
    value: null,
    coverage_n: 0,
    population_n: populationN,
    basis: "not computed for a single-unit read",
    reason: "not_requested",
  });
  return {
    lead_time_seconds_median: one(),
    lead_time_seconds_p90: one(),
    autonomy_rate: one(),
    cost_per_shipped_task_microusd_median: one(),
    land_rate: one(),
    red_to_green_per_pr_median: one(),
    rework_rate: one(),
  };
}

/** A complete 200 body over `units`. */
export function payload(
  units: KpiUnit[],
  over: Partial<KpisPayload> = {}
): KpisPayload {
  return {
    schema: "kpis/v1",
    generated_at: "2026-10-24T12:00:00Z",
    window: {
      days: 28,
      from: "2026-09-26T12:00:00Z",
      to: "2026-10-24T12:00:00Z",
    },
    repos: null,
    population: {
      shipped_units: units.length,
      units_returned: units.length,
      truncated: false,
    },
    aggregates: aggregates(),
    units,
    ...over,
  };
}
