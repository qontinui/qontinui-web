/**
 * The wire shape of `GET /api/v1/overview/schedule` — the project's phases,
 * milestones and decision gates DERIVED from coord, one `Resolved` per figure
 * (plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, D1,
 * D4, D5: derived only, no entered value, overlay or pin).
 *
 * Mirrors the backend's `app/schemas/overview_schedule.py`. Every figure is a
 * `Resolved<T>`: coord's own value (`known`) or no value with the reason
 * (`unknown`). There is no third state. `value` is null exactly when the state is `unknown`, and a
 * failed read is never an empty list.
 */

import { httpClient } from "@/services/service-factory";
import { OVERVIEW_API } from "@/components/overview/editing/api";

export const SCHEDULE_PATH = `${OVERVIEW_API}/schedule`;

/** The server caches a schedule for 60 s; polling faster only repeats it. */
export const SCHEDULE_POLL_MS = 60_000;

export const RESOLVED_STATES = ["known", "unknown"] as const;
export type ResolvedState = (typeof RESOLVED_STATES)[number];

export const SOURCE_KINDS = [
  "coord_work_unit",
  "coord_delivery",
  "coord_document",
  "coord_gates",
  "derived",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const UNKNOWN_REASONS = [
  "coord_unreachable",
  "coord_denied",
  "coord_stale",
  "no_programme",
  "ambiguous_programme",
  "not_declared",
  "not_recorded",
  "ship_retracted",
  "attestation_retracted",
  "tenant_mismatch",
  "unparseable",
  "truncated",
  "phase_dates_missing",
  "no_phases",
  "no_calendar",
] as const;
export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

export const PHASE_STATES = [
  "planned",
  "in_progress",
  "done",
  "not_confirmed",
] as const;
export type SchedulePhaseState = (typeof PHASE_STATES)[number];

export const MILESTONE_STATUSES = ["met", "not_met", "not_confirmed"] as const;
export type ScheduleMilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const GATE_VERDICTS = ["pending", "passed", "failed"] as const;
export type GateVerdict = (typeof GATE_VERDICTS)[number];

export const FORECAST_POSITIONS = [
  "no_phases",
  "in_progress",
  "finished",
  "not_started",
  "between_phases",
] as const;
export type ForecastPosition = (typeof FORECAST_POSITIONS)[number];

export interface Source {
  kind: SourceKind;
  /** Plain words, safe to show. */
  label: string;
  version?: number | null;
}

export interface Resolved<T> {
  value: T | null;
  state: ResolvedState;
  source: Source;
  observed_at: string;
  unknown_since?: string | null;
  unknown_reason?: UnknownReason | null;
  stale?: boolean;
}

export interface PhaseView {
  index: number;
  code: string;
  name: string;
  linked: boolean;
  state: Resolved<SchedulePhaseState>;
  actual_start: Resolved<string>;
  actual_end: Resolved<string>;
  /**
   * What `actual_end` is the date of. `attested` is the day a person confirmed
   * the phase done (shown as "Confirmed done on"), not the day the work
   * finished; `shipped` is a linked unit's first shipped time. Absent on a
   * backend that predates the field, which reads as `shipped`.
   */
  actual_end_basis?: "shipped" | "attested" | null;
  planned_end: Resolved<string>;
  milestone_id: string | null;
}

export interface MilestoneView {
  id: string | null;
  name: string;
  shown_by: string | null;
  target_date: Resolved<string>;
  status: Resolved<ScheduleMilestoneStatus>;
  met_at: Resolved<string>;
  decision_record: string | null;
  decision_record_version: number | null;
}

export interface GateView {
  id: string;
  title: string;
  verdict: GateVerdict;
  decided_at: string | null;
  unit_slug: string | null;
}

export interface PhaseRef {
  code: string;
  name: string;
}

export interface ForecastValue {
  planned_finish: string | null;
  forecast_finish: string | null;
  slip_days: number | null;
  position: ForecastPosition;
  current_phase: PhaseRef | null;
  next_phase: PhaseRef | null;
}

export interface SourceStamp {
  kind: SourceKind;
  label: string;
  version: number | null;
  observed_at: string;
}

export interface ReadCount {
  read: number;
  total: number | null;
  truncated: boolean;
}

export interface ScheduleEnvelope {
  tenant_id: string;
  door: "operator" | "device";
  observed_at: string;
  stale: boolean;
  programme: Resolved<{ slug: string; title: string | null }>;
  initiative: {
    name: string | null;
    version: number | null;
    starts: Resolved<string>;
    ends: Resolved<string>;
  };
  phases: Resolved<PhaseView[]>;
  unreadable_phases: string[];
  milestones: {
    items: Resolved<MilestoneView[]>;
    unreadable_rows: string[];
  };
  gates: {
    items: Resolved<GateView[]>;
    other_checks_not_shown: { total: number; truncated: boolean };
    withdrawn_not_shown: number;
    read: ReadCount;
  };
  forecast: Resolved<ForecastValue>;
  work_units: ReadCount;
  sources: SourceStamp[];
}

/** Enough of a shape check that a proxy error page or a half-written body is
 *  refused rather than rendered as an empty schedule. */
export function isScheduleEnvelope(body: unknown): body is ScheduleEnvelope {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Partial<ScheduleEnvelope>;
  return (
    typeof b.tenant_id === "string" &&
    typeof b.observed_at === "string" &&
    typeof b.phases === "object" &&
    b.phases !== null &&
    typeof b.milestones === "object" &&
    b.milestones !== null &&
    typeof b.gates === "object" &&
    b.gates !== null &&
    typeof b.forecast === "object" &&
    b.forecast !== null
  );
}

export function fetchSchedule(): Promise<ScheduleEnvelope> {
  return httpClient.get<ScheduleEnvelope>(SCHEDULE_PATH);
}
