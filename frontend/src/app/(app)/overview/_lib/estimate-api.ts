/**
 * The wire shapes of the `estimates` resource and the two reads beyond it —
 * the project settings and an estimate's rollup.
 *
 * The estimate itself is read and written through the overview authoring kit
 * (`@/components/overview/editing/api`: `listResource("estimates")`,
 * `getResource`, `createResource`, `updateResource`), which carries the
 * contract every resource shares: the version as `If-Match`, a 409 with the
 * server's copy, an idempotent create, and the write's source for the change
 * log. Nothing here duplicates it.
 *
 * Two conventions, both enforced by the backend rather than restated here:
 *
 * * **Money is an integer count of micros** (millionths of a currency unit).
 * * **Every other decimal is a STRING** — person-days, weeks, FTE, shares.
 *   The backend serializes them that way so nothing in the effort or money
 *   path passes through a float; use `toNumber`/`formatDecimal` from
 *   `@/components/overview/money` to read them.
 *
 * Nothing in this file adds up a total. The rollup endpoint owns every
 * derived figure, so a page and a report cannot disagree about one.
 */

import { httpClient } from "@/services/service-factory";
import { OVERVIEW_API } from "@/components/overview/editing/api";
import type {
  EstimatePurpose,
  LabourBilling,
} from "@/components/overview/vocabulary";

/** Re-exported so the editor can name the choice without a second import. */
export type EstimatePurposeOption = EstimatePurpose;

/** The registry name and route segment of the estimate resource. */
export const ESTIMATES = "estimates";

export type EstimateStatus =
  | "draft"
  | "for_decision"
  | "approved"
  | "superseded";
export type GateStatus = "pending" | "passed" | "failed" | "waived";
export type TaskStatus = "planned" | "in_progress" | "done";
export type CostLineKind = "build_non_labour" | "run_annual";

export interface OverviewSettings {
  base_currency: string;
  fx_rates: Record<string, unknown>;
  labour_billing: LabourBilling;
  hours_per_day: string;
  working_day_factor: string;
  first_value_date: string | null;
  version: number;
  /** True when nobody has saved settings and these are the defaults. */
  is_default: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * One estimate as the `estimates` resource serves it: the head row, and — on
 * a single-record read — its whole content graph. A list read carries
 * `content: null` (graphs are not sent in bulk), never an empty graph.
 */
export interface EstimateRecord {
  id: string;
  name: string;
  purpose: EstimatePurpose;
  status: EstimateStatus;
  is_baseline: boolean;
  source_page_id: string | null;
  accuracy_note: string | null;
  contingency_pct: string | null;
  notes: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  content: EstimateContent | null;
}

export interface RoleRead {
  id: string;
  code: string;
  name: string;
  responsibility: string;
  day_rate_micros: number | null;
  currency: string | null;
  client_side: boolean;
  sort_order: number;
}

export interface TaskEffortRead {
  role_id: string;
  role_code: string;
  planned_person_days: string;
}

export interface PhaseTaskRead {
  id: string;
  number: string;
  title: string;
  requirement_refs: string | null;
  planned_start: string | null;
  planned_end: string | null;
  is_critical: boolean;
  status: TaskStatus;
  sort_order: number;
  efforts: TaskEffortRead[];
}

export interface PhaseRead {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  planned_start: string | null;
  planned_end: string | null;
  stated_working_weeks: string | null;
  gate_criteria: string;
  actual_start: string | null;
  actual_end: string | null;
  gate_status: GateStatus;
  gate_decided_at: string | null;
  gate_notes: string;
  tasks: PhaseTaskRead[];
}

export interface AllocationRead {
  phase_id: string;
  phase_code: string;
  role_id: string;
  role_code: string;
  fte: string;
}

export interface PriceTierRead {
  id: string;
  name: string;
  multiplier: string;
  is_primary: boolean;
  sort_order: number;
}

export interface CostLineRead {
  id: string;
  kind: CostLineKind;
  label: string;
  basis: string;
  low_micros: number | null;
  high_micros: number | null;
  currency: string | null;
  phase_id: string | null;
  phase_code: string | null;
  run_model: string | null;
  sort_order: number;
}

export interface CalendarBreakRead {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
}

export interface EstimateContent {
  roles: RoleRead[];
  phases: PhaseRead[];
  allocations: AllocationRead[];
  price_tiers: PriceTierRead[];
  cost_lines: CostLineRead[];
  calendar_breaks: CalendarBreakRead[];
}

/** A figure the rollup could not produce, and why. Never a zero. */
export interface RollupUnavailable {
  figure: string;
  reason: string;
  detail: string;
}

export interface RollupTier {
  /** `null` for the implicit single price when no tier was created. */
  id: string | null;
  name: string;
  multiplier: string;
  is_primary: boolean;
  labour_micros: number | null;
  contingency_micros: number | null;
  total_low_micros: number | null;
  total_high_micros: number | null;
}

export interface RollupPhase {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  gate_status: GateStatus;
  gate_criteria: string;
  calendar_weeks: string | null;
  working_days: string | null;
  working_weeks: string | null;
  stated_working_weeks: string | null;
  working_weeks_matches_stated: boolean | null;
  person_days: string;
  allocated_fte: string;
  task_count: number;
  critical_task_count: number;
  /** Keyed by tier id, `""` for the implicit tier. Null when unpriced. */
  fees_micros: Record<string, number> | null;
  roles: { role_id: string; person_days: string }[];
}

export interface RollupRole {
  id: string;
  code: string;
  name: string;
  responsibility: string;
  day_rate_micros: number | null;
  currency: string | null;
  client_side: boolean;
  sort_order: number;
  person_days: string;
  person_days_share_pct: string | null;
  fee_micros: number | null;
  fee_share_pct: string | null;
  fees_micros: Record<string, number> | null;
}

export interface EstimateRollup {
  estimate_id: string;
  name: string;
  purpose: EstimatePurpose;
  status: EstimateStatus;
  is_baseline: boolean;
  accuracy_note: string | null;
  version: number;
  generated_at: string;
  settings: {
    base_currency: string;
    labour_billing: LabourBilling;
    hours_per_day: string;
    working_day_factor: string;
  };
  schedule: {
    planned_start: string | null;
    planned_end: string | null;
    calendar_weeks: string | null;
    working_days: string | null;
    working_weeks: string | null;
  };
  effort: {
    total_person_days: string;
    delivery_person_days: string;
    client_side_person_days: string;
  };
  team: {
    average_fte: string | null;
    peak_fte: string | null;
    peak_phase_code: string | null;
  };
  money: {
    currency: string | null;
    totals_currency: string | null;
    contingency_pct: string | null;
    contingency_basis: string;
    primary_tier_id: string | null;
    tiers: RollupTier[];
    build_non_labour: {
      low_micros: number | null;
      high_micros: number | null;
      currency: string | null;
      lines: CostLineRead[];
    };
    run_annual: { lines: CostLineRead[] };
  };
  phases: RollupPhase[];
  roles: RollupRole[];
  /**
   * The FTE matrix, flattened. A READ of `phase_allocations` alone — nothing
   * in it is derived from person-days, which is what keeps team size and
   * effort from double-counting each other.
   */
  allocations: AllocationRead[];
  calendar_breaks: CalendarBreakRead[];
  unavailable: RollupUnavailable[];
}

// ---------------------------------------------------------------------------
// Write payloads
// ---------------------------------------------------------------------------

export interface RoleWrite {
  code: string;
  name: string;
  responsibility?: string;
  day_rate_micros: number | null;
  currency: string | null;
  client_side: boolean;
}

export interface TaskWrite {
  number: string;
  title: string;
  requirement_refs?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  is_critical?: boolean;
  status?: TaskStatus;
  efforts?: { role_code: string; planned_person_days: string }[];
}

/**
 * Every field a content write owns for a phase — its PLAN. It replaces the
 * WHOLE graph, so an omitted field is not "leave it alone" — it is "reset it
 * to its default". Anything added here must also be round-tripped by the
 * editor's draft (`team/edit/_lib/draft.ts`).
 *
 * A phase's progress (actual dates, the gate's outcome) is NOT here: it is
 * written through the `phase_progress` resource (`timeline-api.ts`), and a
 * content write naming it is refused.
 *
 * `id` is identity, not plan: the saved phase this one continues. Sent, the
 * phase keeps its row — its recorded progress and tied milestones — even when
 * its code changed; on an update it must name a phase of THIS estimate or
 * the write is a 422. Omitted, a phase continues the saved one with the same
 * code, and otherwise is new (`droppedPhases` in the editor mirrors the
 * rule). A CREATE ignores it: every phase of a new estimate is new.
 */
export interface PhaseWrite {
  id?: string;
  code: string;
  name: string;
  planned_start?: string | null;
  planned_end?: string | null;
  stated_working_weeks?: string | null;
  gate_criteria?: string;
  tasks?: TaskWrite[];
}

export interface EstimateContentWrite {
  roles: RoleWrite[];
  phases: PhaseWrite[];
  allocations: { phase_code: string; role_code: string; fte: string }[];
  price_tiers: { name: string; multiplier: string; is_primary: boolean }[];
  cost_lines: {
    kind: CostLineKind;
    label: string;
    basis?: string;
    low_micros: number | null;
    high_micros: number | null;
    currency: string | null;
    phase_code?: string | null;
    run_model?: string | null;
  }[];
  calendar_breaks: { label: string; start_date: string; end_date: string }[];
}

/**
 * `acknowledged_drops` on an estimate update (`AcknowledgedDrop`): the writer
 * has seen what dropping one saved phase costs, as it stood then. Needed for
 * each dropped phase holding recorded progress or tied milestones; missing or
 * outdated, the write is a 409 `unacknowledged_drop` and nothing is written.
 */
export interface AcknowledgedDrop {
  phase_id: string;
  /** The phase's progress version (`phase_progress`'s `version`). */
  progress_version: number;
  milestone_count: number;
}

/** One phase in a 409 `unacknowledged_drop` body (its `phases`): what it
 *  holds NOW, which is what a new acknowledgement must name. */
export interface UnacknowledgedDrop {
  phase_id: string;
  code: string;
  name: string;
  progress_version: number;
  milestone_count: number;
  actual_start: string | null;
  actual_end: string | null;
  gate_status: GateStatus;
  gate_decided_at: string | null;
  gate_notes: string;
}

// ---------------------------------------------------------------------------
// Reads beyond the resource contract
// ---------------------------------------------------------------------------

export function fetchSettings(): Promise<OverviewSettings> {
  return httpClient.get<OverviewSettings>(`${OVERVIEW_API}/settings`);
}

export function fetchRollup(id: string): Promise<EstimateRollup> {
  return httpClient.get<EstimateRollup>(
    `${OVERVIEW_API}/estimates/${encodeURIComponent(id)}/rollup`
  );
}

/**
 * The estimate the overview pages read: the one marked baseline, else the
 * newest. The list route already orders baseline-first, so this is the head
 * of the list — spelled out here so the rule lives somewhere a reader can
 * find it rather than being an accident of ordering.
 */
export function pickBaseline(
  estimates: EstimateRecord[]
): EstimateRecord | null {
  return estimates.find((e) => e.is_baseline) ?? estimates[0] ?? null;
}
