/**
 * The wire shapes of `/api/v1/overview/*` and the four reads the Team page
 * and the estimate editor make.
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
import type {
  EstimatePurpose,
  LabourBilling,
} from "@/components/overview/vocabulary";

/** Re-exported so the editor can name the choice without a second import. */
export type EstimatePurposeOption = EstimatePurpose;

export const OVERVIEW_API = "/api/v1/overview";

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

export interface EstimateSummary {
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

export interface EstimateDetail {
  estimate: EstimateSummary;
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

export interface PhaseWrite {
  code: string;
  name: string;
  planned_start?: string | null;
  planned_end?: string | null;
  stated_working_weeks?: string | null;
  gate_criteria?: string;
  gate_status?: GateStatus;
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
  /** From the last read. A 409 means somebody else saved first. */
  expected_version?: number;
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

export function fetchSettings(): Promise<OverviewSettings> {
  return httpClient.get<OverviewSettings>(`${OVERVIEW_API}/settings`);
}

export function fetchEstimates(): Promise<{
  estimates: EstimateSummary[];
  total: number;
}> {
  return httpClient.get(`${OVERVIEW_API}/estimates`);
}

export function fetchEstimate(id: string): Promise<EstimateDetail> {
  return httpClient.get<EstimateDetail>(
    `${OVERVIEW_API}/estimates/${encodeURIComponent(id)}`
  );
}

export function fetchRollup(id: string): Promise<EstimateRollup> {
  return httpClient.get<EstimateRollup>(
    `${OVERVIEW_API}/estimates/${encodeURIComponent(id)}/rollup`
  );
}

export function createEstimate(body: {
  name: string;
  purpose: EstimatePurpose;
  is_baseline: boolean;
  contingency_pct?: string | null;
  accuracy_note?: string | null;
}): Promise<EstimateSummary> {
  return httpClient.post<EstimateSummary>(`${OVERVIEW_API}/estimates`, body);
}

export function patchEstimate(
  id: string,
  body: Record<string, unknown>
): Promise<EstimateSummary> {
  return httpClient.patch<EstimateSummary>(
    `${OVERVIEW_API}/estimates/${encodeURIComponent(id)}`,
    body
  );
}

export function saveEstimateContent(
  id: string,
  body: EstimateContentWrite
): Promise<EstimateDetail> {
  return httpClient.put<EstimateDetail>(
    `${OVERVIEW_API}/estimates/${encodeURIComponent(id)}/content`,
    body
  );
}

/**
 * The estimate the overview pages read: the one marked baseline, else the
 * newest. The list route already orders baseline-first, so this is the head
 * of the list — spelled out here so the rule lives somewhere a reader can
 * find it rather than being an accident of ordering.
 */
export function pickBaseline(
  estimates: EstimateSummary[]
): EstimateSummary | null {
  return estimates.find((e) => e.is_baseline) ?? estimates[0] ?? null;
}
