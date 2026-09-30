/**
 * The domain cost ledger — what reaching autonomy in each declared domain has
 * cost, and whether the second domain came cheaper than the first — as the
 * wire shape and the words the Overview renders it in.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8, over coord's `GET /coord/domain-cost` (Phases 1+2), proxied
 * verbatim by the web backend at `GET /api/v1/operations/domain-cost`.
 *
 * Every number coord serves is `{value, coverage_n, population_n, basis}` plus
 * a `reason` when `value` is `null`, and the rule this module holds is the
 * wire's own: **`null` renders "unknown — <reason>", never `0` and never a
 * dash.** A dimension nobody produces (tokens today) and a domain that spent
 * nothing are different facts, and the falsification verdict depends on the
 * reader being able to tell them apart.
 *
 * Pure: no fetch, no React. `DomainCostSection` renders what this returns.
 */

import { formatDurationSecs } from "@/components/operations/fleetReadout";
import {
  DOMAIN_COST_VERDICT_ATTENTION_BY_KIND,
  type DomainCostVerdictKind,
} from "@/components/operations/domainCostStatus";
import type { RowStatus } from "@/components/console/statusRow";

// ============================================================================
// Wire shape (coord `domain_cost.rs` `assemble_body`)
// ============================================================================

/** One numeric dimension in the D6 shape. */
export interface CostDimension {
  value: number | null;
  coverage_n: number;
  population_n: number;
  basis: string;
  /** Why `value` is null — `no_producer`, `store_absent`, … */
  reason?: string | null;
  /** Wall-clock only: units excluded as a bulk restamp. */
  excluded_restamp_n?: number;
}

/** The dimensions coord serves, in its own order (`DIMENSIONS`). */
export const COST_DIMENSIONS = [
  "work_units",
  "wall_clock_secs",
  "prs",
  "sessions",
  "sessions_trailer",
  "operator_touches",
  "tokens",
] as const;
export type CostDimensionKey = (typeof COST_DIMENSIONS)[number];

/** A bucket's cost. Keyed by `string` so a dimension newer than this build is not dropped. */
export type CostBlock = Partial<Record<CostDimensionKey, CostDimension>> &
  Record<string, CostDimension | undefined>;

export interface DomainCostDomain {
  name: string;
  areas: string[];
  spec: string | null;
  /** The furthest attained stage (`perceive` / `judge` / `decide`), or `null`. */
  stage_reached: string | null;
  /** Why `stage_reached` is null, e.g. `no_attainment_claims`. */
  stage_reason: string | null;
  cost: CostBlock;
}

export interface DomainCostShared {
  areas: string[];
  cost: CostBlock;
  /** Shared units charged to NO domain — no first-consumer record exists yet. */
  shared_unassigned_n: number;
  units: Array<{
    slug: string;
    area: string | null;
    first_consumer: string | null;
    reason?: string | null;
  }>;
}

/** One dimension's ratio row inside `comparison.dimensions`. */
export interface ComparisonDimension {
  R: number | null;
  reason: string | null;
  numerator_value: number | null;
  denominator_value: number | null;
  numerator_coverage: number | null;
  denominator_coverage: number | null;
}

export interface DomainCostComparison {
  numerator: string;
  denominator: string;
  source: string;
  coverage_floor: number;
  marginal_basis?: string;
  compared_stage?: string | null;
  /** True while no stage both domains attained exists — the ratios are then context, not a test. */
  ratios_informational?: boolean;
  dimensions: Record<string, ComparisonDimension>;
  agreement: number | null;
  agreement_reason: string | null;
  /** COMPOUNDED | INCONCLUSIVE | DID_NOT_COMPOUND | UNFALSIFIABLE_AS_MEASURED. */
  verdict: string;
  verdict_reason: string;
}

export interface DomainCostPayload {
  computed_at: string;
  as_of: string | null;
  roster_source: {
    repo: string | null;
    path: string;
    sha: string | null;
    read_at: string;
  };
  /** `null` when the roster could not be read — `roster_error` says why. */
  roster: unknown | null;
  roster_error: string | null;
  roster_error_detail?: string | null;
  /** `null` exactly when `roster` is — never an empty list standing in for "unknown". */
  domains: DomainCostDomain[] | null;
  shared: DomainCostShared | null;
  unmapped_areas: Array<{ area: string; count: number }> | null;
  unattributed_units_n: number;
  comparison: DomainCostComparison | null;
  comparison_reason: string | null;
}

/**
 * Accept a body only when it carries what every reader dereferences: the
 * roster outcome (`domains` an array, or `null` beside a `roster_error`) and
 * the provenance. The proxy forwards whatever coord says, and a body of
 * another shape is a failed read — never an empty ledger.
 */
export function isDomainCostPayload(body: unknown): body is DomainCostPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const source = b.roster_source as Record<string, unknown> | null | undefined;
  return (
    typeof b.computed_at === "string" &&
    typeof source === "object" &&
    source !== null &&
    (Array.isArray(b.domains) || b.domains === null) &&
    typeof b.unattributed_units_n === "number"
  );
}

// ============================================================================
// Words
// ============================================================================

/** "unknown — <reason>" — the one spelling every null takes. */
export function unknownText(reason: string | null | undefined): string {
  return `unknown — ${reason && reason.trim() ? reason : "no reason given"}`;
}

export const DIMENSION_LABEL: Record<CostDimensionKey, string> = {
  work_units: "Work units",
  wall_clock_secs: "Wall-clock",
  prs: "Pull requests landed",
  sessions: "Agent sessions",
  sessions_trailer: "Sessions (commit trailers)",
  operator_touches: "Operator touches",
  tokens: "Tokens",
};

/** A dimension label, falling back to the wire key for one this build does not know. */
export function dimensionLabel(key: string): string {
  return (DIMENSION_LABEL as Record<string, string>)[key] ?? key;
}

/** A dimension's value, formatted; `null` → "unknown — <reason>". */
export function dimensionValueText(
  key: string,
  dim: CostDimension | undefined
): string {
  if (!dim) return unknownText("not served");
  if (dim.value === null) return unknownText(dim.reason);
  if (key === "wall_clock_secs") return formatDurationSecs(dim.value);
  return dim.value.toLocaleString("en-US");
}

/** "40 of 52 observed" — how much of the population the value saw. */
export function coverageText(dim: CostDimension | undefined): string {
  if (!dim) return unknownText("not served");
  return `${dim.coverage_n} of ${dim.population_n} observed`;
}

/** A ratio, or "unknown — <reason>". */
export function ratioText(row: ComparisonDimension | undefined): string {
  if (!row) return unknownText("not compared");
  if (row.R === null) return unknownText(row.reason);
  return row.R.toFixed(2);
}

/** "Stage reached: perceive" / "unknown — no_attainment_claims". */
export function stageText(domain: DomainCostDomain): string {
  return domain.stage_reached ?? unknownText(domain.stage_reason);
}

// ============================================================================
// The verdict — the readout table's rows
// ============================================================================

/** The exact wire strings (`domain_cost.rs` `verdict_wire`). */
const VERDICT_WIRE: Record<string, DomainCostVerdictKind> = {
  COMPOUNDED: "compounded",
  INCONCLUSIVE: "inconclusive",
  DID_NOT_COMPOUND: "did_not_compound",
  UNFALSIFIABLE_AS_MEASURED: "unfalsifiable",
};

const VERDICT_LABEL: Record<DomainCostVerdictKind, string> = {
  compounded: "Compounded",
  inconclusive: "Inconclusive",
  did_not_compound: "Did not compound",
  unfalsifiable: "Unfalsifiable as measured",
  unknown: "Unknown verdict",
};

/**
 * "What the fleet does" — the falsification readout table's third column,
 * verbatim in substance. These sentences ARE the decision rule; a reader
 * seeing the verdict must see the action it commits the fleet to.
 */
export const VERDICT_SENTENCE: Record<
  Exclude<DomainCostVerdictKind, "unknown">,
  string
> = {
  compounded:
    "Proceed to domain 3, and record the reuse floor as the explanation.",
  inconclusive:
    "Proceed to domain 3, which the vision says should be much cheaper. Two consecutive inconclusive domains are read as did not compound.",
  did_not_compound:
    "Each new domain costs about the same. Stop opening new domains, and run the twin audit before any domain-3 work is ranked.",
  unfalsifiable:
    "The only ranked work is attribution coverage. No claim in either direction is reported.",
};

export interface DomainCostVerdict extends RowStatus<DomainCostVerdictKind> {
  /** The readout table's "what the fleet does" sentence. */
  sentence: string;
  /** Coord's own justification (`verdict_reason`). */
  why: string;
}

/**
 * The comparison's verdict, or `null` when there is no comparison (the caller
 * renders `comparison_reason`). An unrecognised verdict string renders
 * `unknown` with the raw string named — never guessed into a row.
 */
export function resolveVerdict(
  comparison: DomainCostComparison
): DomainCostVerdict {
  const kind: DomainCostVerdictKind =
    VERDICT_WIRE[comparison.verdict] ?? "unknown";
  const sentence =
    kind === "unknown"
      ? `${unknownText(`coord returned verdict "${comparison.verdict}", which this build has no sentence for`)}.`
      : VERDICT_SENTENCE[kind];
  return {
    kind,
    label: VERDICT_LABEL[kind],
    reason: comparison.verdict_reason,
    attention: DOMAIN_COST_VERDICT_ATTENTION_BY_KIND[kind],
    sentence,
    why: comparison.verdict_reason,
  };
}
