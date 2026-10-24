/**
 * The `kpis/v1` wire shape — the ONE module that declares it.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4, over coord's
 * `GET /coord/kpis` (Phase 3), proxied verbatim by the web backend at
 * `GET /api/v1/operations/kpis` (`get_kpis`). Every field here is final per the
 * frozen contract; a field is not renamed or added to this file without the
 * coord composer changing first.
 *
 * ## The one rule the shape exists to carry
 *
 * Every figure is a {@link Kpi}: `{value, coverage_n, population_n, basis,
 * reason}`. `value === null` means UNKNOWN and `reason` says why (it is
 * non-null exactly then); `coverage_n` of `population_n` inputs contributed a
 * known reading, so a known value can still be a PARTIAL one. A consumer that
 * reads `.value` directly, instead of going through `describeKpi`
 * (`workUnitKpis.ts`), can turn UNKNOWN into `0` — served policy
 * `verification-and-evidence` `unknown-must-not-render-as-a-default`. That is
 * why no component in the tree reads a `Kpi`'s `value` itself.
 *
 * Pure types plus the one guard: no fetch, no React.
 */

/** The only schema string this build understands. */
export const KPIS_SCHEMA = "kpis/v1";

/**
 * `reason` on an UNKNOWN figure. Coord's closed vocabulary — typed as `string`
 * rather than a union so a reason newer than this build still renders (as its
 * raw code) instead of failing the whole read; `workUnitKpis.ts` words the
 * ones it knows.
 */
export type KpiReason = string;

/** One figure in the domain-cost coverage shape. */
export interface Kpi<T> {
  /** `null` is UNKNOWN. Never `0`, never absent. */
  value: T | null;
  /** How many of `population_n` inputs contributed a known reading. */
  coverage_n: number;
  population_n: number;
  /** A short human sentence naming the unit of the population and the source. */
  basis: string;
  /** Non-null iff `value` is null. */
  reason: KpiReason | null;
}

export interface KpisWindow {
  days: number;
  from: string;
  to: string;
}

export interface KpisPopulation {
  shipped_units: number;
  units_returned: number;
  truncated: boolean;
}

/** The aggregates block. Carried on the wire; rendered only by the Phase 6a tiles. */
export interface KpisAggregates {
  lead_time_seconds_median: Kpi<number>;
  lead_time_seconds_p90: Kpi<number>;
  /** 0..1. */
  autonomy_rate: Kpi<number>;
  /** Micro-USD, a list-price EQUIVALENT. */
  cost_per_shipped_task_microusd_median: Kpi<number>;
  land_rate: Kpi<number>;
  red_to_green_per_pr_median: Kpi<number>;
  rework_rate: Kpi<number>;
}

export interface KpiTokens {
  input: Kpi<number>;
  output: Kpi<number>;
  cache_creation_input: Kpi<number>;
  cache_read_input: Kpi<number>;
}

/** Counts of operator-reaching touches by `policy_authorized`; each `null` = not reported. */
export interface KpiInterventionsSplit {
  policy_authorized_true: number | null;
  policy_authorized_false: number | null;
  policy_authorized_unknown: number | null;
}

export interface KpiUnit {
  slug: string;
  work_unit_id: string;
  status: string;
  shipped_at: string | null;
  /** First `in_progress` → last cited PR landed, seconds. */
  lead_time_seconds: Kpi<number>;
  lead_time_segments: {
    in_progress_to_first_pr_opened_seconds: Kpi<number>;
    first_pr_opened_to_last_landed_seconds: Kpi<number>;
  };
  /** value = distinct sessions of the unit; coverage_n = those with a usage row. */
  sessions: Kpi<number>;
  tokens: KpiTokens;
  /** Micro-USD; a list-price EQUIVALENT, its basis names the reported/estimated mix. */
  cost_microusd: Kpi<number>;
  /** Summed over cited PRs with a known value. */
  ci_attempts: Kpi<number>;
  red_to_green_iterations: Kpi<number>;
  /** Operator-reaching touches. */
  interventions: Kpi<number>;
  interventions_split: KpiInterventionsSplit;
  /** Cited PRs with a revert within 14 days of landing. */
  rework: Kpi<number>;
  prs: { cited: number; landed: number };
}

/** The 200 body of `GET /api/v1/operations/kpis`. */
export interface KpisPayload {
  schema: typeof KPIS_SCHEMA;
  generated_at: string;
  window: KpisWindow;
  /** `null` = every repo of the tenant. */
  repos: string[] | null;
  population: KpisPopulation;
  aggregates: KpisAggregates;
  units: KpiUnit[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * A `Kpi`: a finite number or `null` as value, both counts, a string basis and
 * a string-or-null reason. `reason` MAY be absent on a known value — only a
 * present non-string is malformed.
 */
export function isKpi(v: unknown): v is Kpi<number> {
  if (!isObject(v)) return false;
  return (
    (v.value === null || isCount(v.value)) &&
    isCount(v.coverage_n) &&
    isCount(v.population_n) &&
    typeof v.basis === "string" &&
    (v.reason === null ||
      v.reason === undefined ||
      typeof v.reason === "string")
  );
}

const TOKEN_KEYS = [
  "input",
  "output",
  "cache_creation_input",
  "cache_read_input",
] as const;

const SEGMENT_KEYS = [
  "in_progress_to_first_pr_opened_seconds",
  "first_pr_opened_to_last_landed_seconds",
] as const;

const UNIT_KPI_KEYS = [
  "lead_time_seconds",
  "sessions",
  "cost_microusd",
  "ci_attempts",
  "red_to_green_iterations",
  "interventions",
  "rework",
] as const;

function isUnit(v: unknown): v is KpiUnit {
  if (!isObject(v)) return false;
  if (typeof v.slug !== "string" || v.slug === "") return false;
  if (!UNIT_KPI_KEYS.every((k) => isKpi(v[k]))) return false;
  const tokens = v.tokens;
  if (!isObject(tokens) || !TOKEN_KEYS.every((k) => isKpi(tokens[k]))) {
    return false;
  }
  const segments = v.lead_time_segments;
  if (!isObject(segments) || !SEGMENT_KEYS.every((k) => isKpi(segments[k]))) {
    return false;
  }
  // `interventions_split` and `prs` are plain integers-or-null, not Kpis; they
  // are validated by presence of the object only, because a figure inside them
  // that is absent renders "not reported", which is the honest reading.
  return isObject(v.interventions_split) && isObject(v.prs);
}

/**
 * Accept a body only when it carries everything the work-unit pages
 * dereference: the schema string, the window, the population and every unit
 * with every figure it renders. The proxy forwards whatever coord says, and a
 * body of another shape — a different schema version, or a PARTIAL one — is a
 * failed read ("KPIs unavailable"), never a half-rendered table with zeros
 * where the missing figures were.
 *
 * `aggregates` is not checked: no work-unit page renders it.
 */
export function isKpisPayload(body: unknown): body is KpisPayload {
  if (!isObject(body)) return false;
  const { window, population, units } = body;
  return (
    body.schema === KPIS_SCHEMA &&
    isObject(window) &&
    isCount(window.days) &&
    typeof window.from === "string" &&
    typeof window.to === "string" &&
    isObject(population) &&
    isCount(population.shipped_units) &&
    isCount(population.units_returned) &&
    typeof population.truncated === "boolean" &&
    Array.isArray(units) &&
    units.every(isUnit)
  );
}
