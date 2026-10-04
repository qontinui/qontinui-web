/**
 * The wire shapes the Timeline reads and writes: a phase's progress, the
 * milestones, and the estimate's forecast.
 *
 * Progress and milestones are resources on the overview authoring contract,
 * read and written through the kit (`useResourceList("phase-progress")`,
 * `useResourceList("milestones")`), which carries `If-Match`, the 409 with
 * the server's copy and the change log. The forecast is a read beyond the
 * contract, like the estimate's rollup: every derived date and slip comes
 * from the server, so this page does no schedule arithmetic of its own
 * beyond placing bars.
 */

import { httpClient } from "@/services/service-factory";
import { OVERVIEW_API } from "@/components/overview/editing/api";
import type { GateStatus } from "./estimate-api";

/** Registry names and route segments. */
export const PHASE_PROGRESS = "phase_progress";
export const PHASE_PROGRESS_PATH = "phase-progress";
export const MILESTONES = "milestones";
export const MILESTONES_PATH = "milestones";

/**
 * What actually happened in one phase. `id` is the phase's id. The plan
 * fields (code, name, planned dates, criteria) are the estimate's and
 * read-only here; `version` covers the progress fields only.
 */
export interface PhaseProgress {
  id: string;
  estimate_id: string;
  code: string;
  name: string;
  sort_order: number;
  planned_start: string | null;
  planned_end: string | null;
  gate_criteria: string;
  actual_start: string | null;
  actual_end: string | null;
  gate_status: GateStatus;
  gate_decided_at: string | null;
  gate_notes: string;
  version: number;
  /** Who last recorded progress — null until somebody has. */
  updated_at: string | null;
  updated_by: string | null;
}

/** The progress fields a write may send; absent ones are left alone. */
export type PhaseProgressPatch = Partial<
  Pick<
    PhaseProgress,
    | "actual_start"
    | "actual_end"
    | "gate_status"
    | "gate_decided_at"
    | "gate_notes"
  >
>;

export type MilestoneKind = "milestone" | "pilot" | "first_value" | "other";
export type MilestoneStatus = "planned" | "in_progress" | "done" | "at_risk";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  kind: MilestoneKind;
  phase_id: string | null;
  phase_code: string | null;
  target_date: string;
  /** Set exactly when the milestone is done. */
  completed_date: string | null;
  status: MilestoneStatus;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type PhaseState = "not_started" | "in_progress" | "done";
export type SchedulePosition =
  | "no_phases"
  | "not_started"
  | "in_progress"
  | "between_phases"
  | "finished";

export interface PhaseRef {
  id: string;
  code: string;
  name: string;
}

export interface PhaseForecast extends PhaseRef {
  state: PhaseState;
  forecast_start: string | null;
  forecast_end: string | null;
  /** Calendar days later (+) or earlier (−) than planned. */
  start_slip_days: number | null;
  finish_slip_days: number | null;
}

/** Where the delivery stands against its plan, computed on read. A figure
 *  the server could not produce is null and named in `unavailable`. */
export interface TimelineForecast {
  estimate_id: string;
  estimate_version: number;
  /** The day the server took as today. */
  today: string;
  planned_start: string | null;
  planned_finish: string | null;
  calendar_weeks: string | null;
  working_weeks: string | null;
  position: SchedulePosition;
  current_phase: PhaseRef | null;
  next_phase: PhaseRef | null;
  next_gate: (PhaseRef & { criteria: string }) | null;
  forecast_finish: string | null;
  /** Never shown bare: worded as "late" or "early" (`describeSlip`). */
  slip_days: number | null;
  phases: PhaseForecast[];
  unavailable: { figure: string; reason: string; detail: string }[];
}

export function fetchForecast(estimateId: string): Promise<TimelineForecast> {
  return httpClient.get<TimelineForecast>(
    `${OVERVIEW_API}/estimates/${encodeURIComponent(estimateId)}/forecast`
  );
}
