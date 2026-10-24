/**
 * The words of the work-unit KPIs: how one `kpis/v1` figure becomes text, and
 * how the two work-unit pages find a unit's figures. Pure — no fetch, no React.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4, over the wire shape
 * in `kpisV1.ts`. Rendering follows the Overview's domain-cost convention
 * (`app/(app)/overview/_lib/domainCost.ts`): a figure is
 * `{value, coverage_n, population_n, basis, reason}`, coverage is written as
 * "N of M observed" (the one exception is the sessions count, which is exact
 * and says "3 sessions, 2 with usage data" — see {@link ExactCount}), and
 * **`null` renders "unknown — <reason>", never `0`, never
 * a dash, never blank** (served policy `verification-and-evidence`
 * `unknown-must-not-render-as-a-default`). `unknownText` is that module's own
 * export, reused rather than re-spelled so the two surfaces cannot drift.
 *
 * ## ONE helper renders every figure
 *
 * {@link describeKpi} is the only function in the tree that turns a `Kpi`'s
 * `value` into text. Every cell on `/admin/coord/work-units`, every row of the block on
 * `/admin/coord/work-units/[slug]`, and every composed cell (tokens) goes
 * through it, so a new figure inherits the UNKNOWN and coverage rules by
 * construction instead of by a reviewer remembering them.
 *
 * ## Cost is a LABELLED equivalent
 *
 * `cost_microusd` is a list-price EQUIVALENT — what the same tokens would cost
 * at published list prices, mixing reported and estimated figures — not billed
 * spend (served policy `production-and-cost`
 * `per-task-cost-is-a-labelled-equivalent`). {@link LIST_PRICE_LABEL} is
 * attached by the column, not by trusting coord's `basis` to carry it.
 *
 * ## Deliberately absent
 *
 * No composite "efficiency score" (D6) and no "developer hours saved" (D8):
 * the figures are shown separately, as coord reports them. The aggregates block
 * is not rendered here — aggregate tiles live on `/admin/coord/home` (Phase 6a).
 */

import { unknownText } from "@/app/(app)/overview/_lib/domainCost";
import { formatDurationSecs } from "@/components/operations/fleetReadout";
import type {
  Kpi,
  KpiUnit,
  KpisPayload,
  KpisPopulation,
  KpisWindow,
} from "./kpisV1";

// ============================================================================
// Words
// ============================================================================

/** Printed with every cost figure. */
export const LIST_PRICE_LABEL = "list-price equivalent";

/** Why a 2xx whose body is not a readable `kpis/v1` document is "unavailable". */
export const KPIS_SCHEMA_MISMATCH_REASON =
  "coord answered, but not with a kpis/v1 body this build can read";

/**
 * Coord's closed `reason` vocabulary, in words. R8: a raw `no_usage_rows` is
 * internal vocabulary on a primary surface. A reason newer than this table
 * falls through as its raw code (see {@link reasonWords}); the raw code is also
 * always on `data-kpi-reason` and in the hover title.
 */
const REASON_WORDS: Record<string, string> = {
  not_yet_measured: "not yet measured",
  no_usage_rows: "no usage rows recorded",
  no_cited_prs: "no cited PRs",
  not_landed: "not landed",
  not_established: "not established",
  door_unavailable: "source unavailable",
  no_red_main_attribution: "no red-main attribution recorded",
  revert_probe_not_run: "revert probe has not run",
  empty_population: "empty population",
  not_requested: "not computed for a single-unit read",
  // Ours, not coord's: the figure was absent from an answer that should carry it.
  not_served: "not served by this coord",
};

/** A reason, in words; an unrecognised code is kept raw rather than dropped. */
export function reasonWords(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason.trim() === "") {
    return "no reason given";
  }
  // Own-key lookup: a bare index would return Object.prototype's function for a
  // reason such as "constructor", which is not a string and crashes the render.
  const words = Object.prototype.hasOwnProperty.call(REASON_WORDS, reason)
    ? REASON_WORDS[reason]
    : undefined;
  return words ?? reason;
}

/** "2 of 3 observed" — how much of the population the figure saw. */
export function coverageText(coverageN: number, populationN: number): string {
  return `${coverageN} of ${populationN} observed`;
}

// ============================================================================
// Formatters (a `Kpi`'s value, once it is known)
// ============================================================================

/** What a negative duration prints: an anomaly to be seen, not a `0s`. */
export const NEGATIVE_DURATION_TEXT = "negative (timestamps out of order)";

/**
 * `1h 30m`, `45s` — and a NEGATIVE duration (a PR opened before the unit went
 * `in_progress`) as {@link NEGATIVE_DURATION_TEXT}. The shared
 * `formatDurationSecs` clamps at zero for its other callers, which would print
 * `0s` here: a known value that reads as "instant" when it is really a
 * timestamp-ordering fault. Handled here, before the shared helper, so its
 * behaviour for the fleet readouts is untouched.
 */
export function formatSeconds(secs: number): string {
  return secs < 0 ? NEGATIVE_DURATION_TEXT : formatDurationSecs(secs);
}

/** `12,345`. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** `12K`, `1.2M` — a token count in a row chip, where width is the budget. */
export function formatCompactCount(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** What a negative cost prints: an anomaly to be seen, not `-$0.0000`. */
export const NEGATIVE_COST_TEXT = "negative (cost out of range)";

/**
 * Micro-USD as dollars: `$2.50`, four places below a cent so it is not
 * `$0.00`, and `<$0.0001` for a positive amount that would still round to
 * zero at four places (1..49 micro-USD) — a cost that was incurred never
 * prints as `$0.0000`. A NEGATIVE cost is not a cost at all, and a tiny one
 * would print as `-$0.0000`, a zero-looking number; any negative prints as
 * {@link NEGATIVE_COST_TEXT}, the way a negative duration does.
 */
export function formatMicroUsd(micro: number): string {
  if (micro < 0) return NEGATIVE_COST_TEXT;
  const sub = micro !== 0 && Math.abs(micro) < 10_000;
  const text = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: sub ? 4 : 2,
    maximumFractionDigits: sub ? 4 : 2,
  }).format(micro / 1_000_000);
  return micro > 0 && /^\$0\.0+$/.test(text) ? "<$0.0001" : text;
}

// ============================================================================
// The one helper
// ============================================================================

/** One figure, rendered. */
export interface KpiView {
  /** `unknown` iff `value` was null (or the figure was not served at all). */
  kind: "known" | "unknown";
  /**
   * What a compact cell prints: the formatted value — with `(n/m)` appended
   * when only part of the population contributed — or `unknown`.
   */
  text: string;
  /**
   * The whole sentence, for the detail block and the hover: the value (with
   * its unit suffix) or "unknown — <reason>", then the coverage.
   */
  detail: string;
  /** "2 of 3 observed". */
  coverage: string;
  /** A known value that saw only part of its population. */
  partial: boolean;
  /** The raw reason code on an UNKNOWN figure, else `null`. */
  reason: string | null;
  /** Coord's sentence naming the population and the source; `""` when not served. */
  basis: string;
}

/** How {@link describeKpi} words an EXACT count whose coverage is about something else. */
export interface ExactCount {
  /** The coverage clause, from `coverage_n` / `population_n`. */
  coverage: (coverageN: number, populationN: number) => string;
}

export interface DescribeKpiOptions {
  /** Goes on the DETAIL sentence only (`list-price equivalent`). */
  suffix?: string;
  /**
   * The value is an EXACT count and `coverage_n` says something else about its
   * items — for sessions, how many have a usage row. Coverage is then a
   * clause of its own ("3 sessions, 2 with usage data"), never `(n/m)` on the
   * number and never `partial`: the count is not part-seen.
   */
  exact?: ExactCount;
}

/**
 * The only function that turns a `Kpi`'s `value` into text.
 *
 * - `value === null` (or a figure that is missing from the answer) →
 *   `unknown`, with the reason in words and, except under `options.exact`, the
 *   coverage. Never `0`.
 * - a NON-NULL `reason` also means `unknown`, whatever `value` holds. The
 *   contract says `reason` is non-null iff `value` is null, so a figure that
 *   carries both is coord contradicting itself, and the number is not shown:
 *   `{value: 0, reason: "no_usage_rows"}` is "no usage rows recorded", not
 *   `$0.00`. The read is not rejected for it (see `isKpi`).
 * - a known value with `coverage_n < population_n` → `partial`, and the cell
 *   text carries `(n/m)` so a number that saw 2 of 3 inputs never reads as one
 *   that saw all three.
 * - `options.exact` words a count whose coverage is not about how much of it
 *   was seen (sessions).
 */
export function describeKpi(
  kpi: Kpi<number> | null | undefined,
  format: (value: number) => string,
  options: DescribeKpiOptions = {}
): KpiView {
  if (!kpi) {
    return {
      kind: "unknown",
      text: "unknown",
      detail: unknownText(reasonWords("not_served")),
      coverage: "coverage unknown",
      partial: false,
      reason: "not_served",
      basis: "",
    };
  }
  const basis = kpi.basis ?? "";
  const hasReason = kpi.reason !== null && kpi.reason !== undefined;
  if (kpi.value === null || kpi.value === undefined || hasReason) {
    // An EXACT count that is unknown says only `unknown` and why. Its coverage
    // is about the items of a count that was not established, so "(0 with usage
    // data)" beside it would be a zero-reading fact next to an unknown number.
    const coverage = options.exact
      ? "coverage not stated"
      : coverageText(kpi.coverage_n, kpi.population_n);
    return {
      kind: "unknown",
      text: "unknown",
      detail: options.exact
        ? unknownText(reasonWords(kpi.reason))
        : `${unknownText(reasonWords(kpi.reason))} (${coverage})`,
      coverage,
      partial: false,
      reason: kpi.reason ?? null,
      basis,
    };
  }
  const coverage = options.exact
    ? options.exact.coverage(kpi.coverage_n, kpi.population_n)
    : coverageText(kpi.coverage_n, kpi.population_n);
  const value = format(kpi.value);
  const withSuffix = options.suffix ? `${value} ${options.suffix}` : value;
  if (options.exact) {
    return {
      kind: "known",
      text: value,
      detail: `${withSuffix}, ${coverage}`,
      coverage,
      partial: false,
      reason: null,
      basis,
    };
  }
  const partial = kpi.coverage_n < kpi.population_n;
  return {
    kind: "known",
    text: partial ? `${value} (${kpi.coverage_n}/${kpi.population_n})` : value,
    detail: `${withSuffix} (${coverage})`,
    coverage,
    partial,
    reason: null,
    basis,
  };
}

/** The hover text of a cell: the sentence, then the population's basis. */
export function kpiTitle(label: string, view: KpiView): string {
  return `${label}: ${view.detail}${view.basis ? ` — ${view.basis}` : ""}`;
}

// ============================================================================
// Columns — the seven figures on a work-unit row, and the rows of the block
// ============================================================================

export type KpiColumnKey =
  | "lead_time"
  | "tokens"
  | "cost"
  | "ci_attempts"
  | "red_to_green"
  | "interventions"
  | "rework";

export interface KpiColumn {
  key: KpiColumnKey;
  /** The chip's own label — short, the row has a line to share. */
  short: string;
  /** The block's row label — the whole name. */
  label: string;
}

/** In the order the plan lists them. */
export const KPI_COLUMNS: readonly KpiColumn[] = [
  { key: "lead_time", short: "lead", label: "Lead time" },
  { key: "tokens", short: "tokens", label: "Tokens" },
  {
    key: "cost",
    short: "list-price equiv.",
    label: `Cost (${LIST_PRICE_LABEL})`,
  },
  { key: "ci_attempts", short: "CI attempts", label: "CI attempts" },
  { key: "red_to_green", short: "red→green", label: "Red→green iterations" },
  { key: "interventions", short: "interventions", label: "Interventions" },
  { key: "rework", short: "rework", label: "Rework" },
] as const;

/**
 * The tokens cell: input and output, each through {@link describeKpi}. The two
 * cache classes are in the block, not the row. Both UNKNOWN collapses to one
 * `unknown`; one known keeps the other's `unknown` beside it — a half-known
 * pair is never summed, and never padded with a zero.
 */
function tokensView(unit: KpiUnit): KpiView {
  const input = describeKpi(unit.tokens.input, formatCompactCount);
  const output = describeKpi(unit.tokens.output, formatCompactCount);
  const detail = `input — ${input.detail}; output — ${output.detail}`;
  if (input.kind === "unknown" && output.kind === "unknown") {
    return {
      kind: "unknown",
      text: "unknown",
      detail,
      coverage: input.coverage,
      partial: false,
      reason: input.reason,
      basis: input.basis,
    };
  }
  return {
    kind: "known",
    text: `in ${input.text} · out ${output.text}`,
    detail,
    coverage: `input ${input.coverage}; output ${output.coverage}`,
    partial: input.partial || output.partial,
    reason: null,
    basis: input.basis || output.basis,
  };
}

/** Every column of one unit, each through {@link describeKpi}. */
export function unitColumnViews(unit: KpiUnit): Record<KpiColumnKey, KpiView> {
  return {
    lead_time: describeKpi(unit.lead_time_seconds, formatSeconds),
    tokens: tokensView(unit),
    cost: describeKpi(unit.cost_microusd, formatMicroUsd, {
      suffix: LIST_PRICE_LABEL,
    }),
    ci_attempts: describeKpi(unit.ci_attempts, formatCount),
    red_to_green: describeKpi(unit.red_to_green_iterations, formatCount),
    interventions: describeKpi(unit.interventions, formatCount),
    rework: describeKpi(unit.rework, formatCount),
  };
}

/** One row of the detail block. */
export interface KpiBlockRow {
  id: string;
  label: string;
  view: KpiView;
  /** A sub-figure of the row above it (a segment, a token class). */
  nested?: boolean;
}

/** `3 sessions`, `1 session`. */
export function formatSessions(n: number): string {
  return `${formatCount(n)} session${n === 1 ? "" : "s"}`;
}

/**
 * The sessions figure is an EXACT count — `value` is the distinct sessions of
 * the unit — and `coverage_n` is how many of them have a usage row. So
 * "3 (2 of 3 observed)" would read as a count that saw only two thirds of the
 * sessions; it is "3 sessions, 2 with usage data".
 */
const SESSIONS_EXACT: ExactCount = {
  coverage: (withUsage) => `${formatCount(withUsage)} with usage data`,
};

/** A plain integer that is not a `Kpi` (the PR counts): known, or "not reported". */
function plainCount(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n)
    ? formatCount(n)
    : "not reported";
}

/** The PR counts, as one sentence. */
export function prsText(unit: KpiUnit): string {
  return `cited ${plainCount(unit.prs?.cited)} · landed ${plainCount(unit.prs?.landed)}`;
}

const SPLIT_LABELS: ReadonlyArray<
  readonly [keyof KpiUnit["interventions_split"], string]
> = [
  ["policy_authorized_true", "policy-authorized"],
  ["policy_authorized_false", "not policy-authorized"],
  ["policy_authorized_unknown", "authorization unknown"],
];

/**
 * The interventions split. Each part is a count or `null`; `null` is "not
 * reported", never `0` — the column is tri-state and `unknown` is the common
 * case (`operator_touches.rs`).
 */
export function interventionsSplitText(unit: KpiUnit): string {
  const split = unit.interventions_split;
  return SPLIT_LABELS.map(([key, label]) => {
    const v = split?.[key];
    return `${label} ${
      typeof v === "number" && Number.isFinite(v)
        ? formatCount(v)
        : "not reported"
    }`;
  }).join(" · ");
}

/** The rows of the detail block, in reading order. */
export function unitBlockRows(unit: KpiUnit): KpiBlockRow[] {
  const row = (
    id: string,
    label: string,
    kpi: Kpi<number>,
    format: (v: number) => string,
    nested = false,
    options: DescribeKpiOptions = {}
  ): KpiBlockRow => ({
    id,
    label,
    view: describeKpi(kpi, format, options),
    nested,
  });
  return [
    row("lead_time", "Lead time", unit.lead_time_seconds, formatSeconds),
    row(
      "lead_time_to_first_pr",
      "In progress → first PR opened",
      unit.lead_time_segments.in_progress_to_first_pr_opened_seconds,
      formatSeconds,
      true
    ),
    row(
      "lead_time_first_pr_to_landed",
      "First PR opened → last PR landed",
      unit.lead_time_segments.first_pr_opened_to_last_landed_seconds,
      formatSeconds,
      true
    ),
    row("sessions", "Agent sessions", unit.sessions, formatSessions, false, {
      exact: SESSIONS_EXACT,
    }),
    row("tokens_input", "Input tokens", unit.tokens.input, formatCount),
    row("tokens_output", "Output tokens", unit.tokens.output, formatCount),
    row(
      "tokens_cache_creation_input",
      "Cache-creation input tokens",
      unit.tokens.cache_creation_input,
      formatCount
    ),
    row(
      "tokens_cache_read_input",
      "Cache-read input tokens",
      unit.tokens.cache_read_input,
      formatCount
    ),
    row(
      "cost",
      `Cost (${LIST_PRICE_LABEL})`,
      unit.cost_microusd,
      formatMicroUsd,
      false,
      {
        suffix: LIST_PRICE_LABEL,
      }
    ),
    row("ci_attempts", "CI attempts", unit.ci_attempts, formatCount),
    row(
      "red_to_green",
      "Red→green iterations",
      unit.red_to_green_iterations,
      formatCount
    ),
    row("interventions", "Interventions", unit.interventions, formatCount),
    row(
      "rework",
      "Rework (reverted within 14 days of landing)",
      unit.rework,
      formatCount
    ),
  ];
}

// ============================================================================
// Reading the answer: one fetch, indexed by slug
// ============================================================================

/**
 * What one KPI read produced — the page-level state, shared by both pages.
 *
 * - `pending`: no answer yet. Nothing is shown.
 * - `unavailable`: the read FAILED or came back in a shape this build cannot
 *   read. No figure is shown, anywhere, and no figure is made up.
 * - `loaded`: coord answered. `staleReason` is set when a LATER re-read failed
 *   and these figures are the last good ones. `requestedSlug` is non-null when
 *   the read asked coord for ONE unit (`slug=`), in which case `units` holds
 *   that unit or is empty — and empty means coord has no row for it, which is
 *   a different fact from "not among the window's returned units".
 */
export type KpiIndex =
  | { state: "pending" }
  | { state: "unavailable"; reason: string }
  | {
      state: "loaded";
      bySlug: ReadonlyMap<string, KpiUnit>;
      window: KpisWindow;
      population: KpisPopulation;
      generatedAt: string;
      readAt: string;
      staleReason: string | null;
      requestedSlug: string | null;
    };

export const KPI_PENDING: KpiIndex = { state: "pending" };

export function indexKpis(
  payload: KpisPayload,
  readAt: string,
  staleReason: string | null = null,
  requestedSlug: string | null = null
): KpiIndex {
  return {
    state: "loaded",
    bySlug: new Map(payload.units.map((u) => [u.slug, u])),
    window: payload.window,
    population: payload.population,
    generatedAt: payload.generated_at,
    readAt,
    staleReason,
    requestedSlug,
  };
}

/** What one work unit's row or block shows. */
export type KpiCell =
  | { kind: "pending" }
  | { kind: "unavailable"; reason: string }
  /** Coord answered, and this unit is not among the units it returned. */
  | { kind: "outside"; sentence: string; coverageUnknown: boolean }
  /** Coord was asked for this unit by slug and has no row for it. */
  | { kind: "unrecorded"; sentence: string }
  | { kind: "unit"; unit: KpiUnit };

/**
 * A unit's cell. A unit absent from the answer is NOT "zero everything":
 *
 * - the answer was complete → this unit is not one of the shipped units in the
 *   window (a draft, a unit shipped earlier, or a repo outside the selection),
 *   so it has no KPI row, and the sentence says that;
 * - the answer was TRUNCATED → whether this unit has a row is unknown;
 * - the read asked for THIS unit by slug and `units` came back without it →
 *   coord has no KPI row for it, which is "no KPIs recorded" — a complete
 *   answer to the question asked, so there is no window and no truncation to
 *   reason about.
 */
export function kpiCell(index: KpiIndex, slug: string): KpiCell {
  if (index.state === "pending") return { kind: "pending" };
  if (index.state === "unavailable") {
    return { kind: "unavailable", reason: index.reason };
  }
  const unit = index.bySlug.get(slug);
  if (unit) return { kind: "unit", unit };
  if (index.requestedSlug !== null) {
    return {
      kind: "unrecorded",
      sentence: "No KPIs recorded: coord has no KPI row for this work unit.",
    };
  }
  const { days } = index.window;
  const { units_returned: returned, shipped_units: shipped } = index.population;
  if (index.population.truncated) {
    return {
      kind: "outside",
      coverageUnknown: true,
      sentence: `${unknownText(
        `coord returned ${returned} of ${shipped} shipped work units for the last ${days} days, so whether this one has KPIs is not known`
      )}.`,
    };
  }
  return {
    kind: "outside",
    coverageUnknown: false,
    sentence: `No KPIs in the last ${days} days: this work unit is not among the ${shipped} shipped work unit${shipped === 1 ? "" : "s"} coord measured for that window.`,
  };
}

/** The chip a row prints for a unit coord returned no row for. */
export function outsideChipText(cell: Extract<KpiCell, { kind: "outside" }>) {
  return cell.coverageUnknown ? "KPIs unknown" : "no KPIs in window";
}

/** A date from an RFC 3339 instant, for the window sentence. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** `2026-10-24 12:01Z` — minute precision, UTC, no locale drift. */
function stamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** The page-level sentence under the controls. */
export function describeKpiIndex(index: KpiIndex): string {
  switch (index.state) {
    case "pending":
      return "Reading KPIs…";
    case "unavailable":
      return `KPIs unavailable — ${index.reason}. No KPI figures are shown; nothing else on this page depends on them.`;
    case "loaded": {
      if (index.requestedSlug !== null) {
        const single = `KPIs for this work unit. Cost is a ${LIST_PRICE_LABEL}, not billed spend. A figure that saw only part of its inputs says how many; unknown is never zero. Read ${stamp(index.readAt)}; read once per page load.`;
        return index.staleReason
          ? `${single} The latest re-read failed (${index.staleReason}); these are the last good figures.`
          : single;
      }
      const { population } = index;
      const { days, from, to } = index.window;
      const base = `KPIs for work units shipped in the last ${days} days (${day(from)} to ${day(to)}): ${population.units_returned} of ${population.shipped_units} returned${population.truncated ? ", TRUNCATED — the rest are not shown" : ""}. Cost is a ${LIST_PRICE_LABEL}, not billed spend. A figure that saw only part of its inputs says how many; unknown is never zero. Read ${stamp(index.readAt)}; re-read only on Refresh or a window change.`;
      return index.staleReason
        ? `${base} The latest re-read failed (${index.staleReason}); these are the last good figures.`
        : base;
    }
  }
}

/**
 * The short WORD a folded panel keeps in its header (R7: the signal survives
 * the fold). Always a word or a window, never a count that could read as zero.
 */
export function kpiPanelSummary(index: KpiIndex, cell: KpiCell): string {
  switch (cell.kind) {
    case "pending":
      return "reading";
    case "unavailable":
      return "unavailable";
    case "outside":
      return cell.coverageUnknown ? "unknown" : "none in window";
    case "unrecorded":
      return "none recorded";
    case "unit":
      if (index.state !== "loaded") return "";
      return index.requestedSlug !== null
        ? "recorded"
        : `${index.window.days}d window`;
  }
}

// ============================================================================
// The window control
// ============================================================================

/** Coord's `window` grammar (`28d`, 1..=365). The options the pages offer. */
export const KPI_WINDOWS = [
  { value: "7d", label: "Last 7 days" },
  { value: "28d", label: "Last 28 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "365d", label: "Last 365 days" },
] as const;

export type KpiWindowValue = (typeof KPI_WINDOWS)[number]["value"];

/** Coord's own default, sent explicitly so the control and the answer agree. */
export const DEFAULT_KPI_WINDOW: KpiWindowValue = "28d";
