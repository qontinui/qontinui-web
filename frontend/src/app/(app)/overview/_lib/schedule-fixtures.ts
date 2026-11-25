/**
 * Synthetic schedule envelopes for the overview's tests. Every name, date and
 * phase here is invented: no tenant's data is copied into this repository.
 * Shapes follow `GET /api/v1/overview/schedule` (`schedule-api.ts`).
 */

import type {
  GateView,
  MilestoneView,
  PhaseView,
  Resolved,
  ScheduleEnvelope,
  SchedulePhaseState,
  ScheduleMilestoneStatus,
  SourceKind,
  UnknownReason,
} from "./schedule-api";

export const OBSERVED_AT = "2026-11-25T12:00:00Z";

export function known<T>(
  value: T,
  kind: SourceKind = "coord_work_unit",
  label = "The delivery programme"
): Resolved<T> {
  return {
    value,
    state: "known",
    source: { kind, label, version: null },
    observed_at: OBSERVED_AT,
    unknown_since: null,
    unknown_reason: null,
    stale: false,
  };
}

export function unknown<T>(
  reason: UnknownReason,
  since: string | null = null
): Resolved<T> {
  return {
    value: null,
    state: "unknown",
    source: { kind: "derived", label: "Not available", version: null },
    observed_at: OBSERVED_AT,
    unknown_since: since,
    unknown_reason: reason,
    stale: false,
  };
}

export function phase(
  index: number,
  code: string,
  name: string,
  over: Partial<Omit<PhaseView, "state">> & { state?: SchedulePhaseState } = {}
): PhaseView {
  const { state = "not_confirmed", ...rest } = over;
  return {
    index,
    code,
    name,
    linked: false,
    state: known<SchedulePhaseState>(state, "coord_delivery"),
    actual_start: unknown("not_declared"),
    actual_end: unknown("not_declared"),
    planned_end: unknown("not_declared"),
    milestone_id: null,
    ...rest,
  };
}

export function milestone(
  name: string,
  date: string | null,
  status: ScheduleMilestoneStatus = "not_confirmed",
  over: Partial<MilestoneView> = {}
): MilestoneView {
  return {
    id: null,
    name,
    shown_by: null,
    target_date: date ? known(date, "coord_document") : unknown("not_declared"),
    status: known<ScheduleMilestoneStatus>(status, "coord_document"),
    met_at: unknown("not_recorded"),
    decision_record: null,
    decision_record_version: null,
    ...over,
  };
}

/** Three phases and two milestones: one done with no recorded dates, one
 *  under way, one coord holds no evidence for either way. */
export function envelope(
  over: Partial<ScheduleEnvelope> = {}
): ScheduleEnvelope {
  return {
    tenant_id: "00000000-0000-0000-0000-00000000aaaa",
    door: "operator",
    observed_at: OBSERVED_AT,
    stale: false,
    programme: known({
      slug: "delivery-programme",
      title: "Delivery programme",
    }),
    initiative: {
      name: "initiative/current",
      version: 2,
      starts: known("2026-10-19", "coord_document"),
      ends: known("2027-01-22", "coord_document"),
    },
    phases: known<PhaseView[]>(
      [
        phase(1, "F1", "F1 Foundation", {
          state: "done",
          actual_start: unknown("not_recorded"),
          actual_end: unknown("not_recorded"),
        }),
        phase(2, "F2", "F2 First release", {
          state: "in_progress",
          linked: true,
          actual_start: known("2026-11-02", "coord_work_unit"),
          actual_end: unknown("not_recorded"),
        }),
        phase(3, "F3", "F3 Rollout"),
      ],
      "coord_delivery"
    ),
    unreadable_phases: [],
    milestones: {
      items: known<MilestoneView[]>(
        [
          milestone("Launch review", "2026-12-01"),
          milestone("Pilot go-live", "2026-12-18"),
        ],
        "coord_document"
      ),
      unreadable_rows: [],
    },
    gates: {
      items: known<GateView[]>([], "coord_gates"),
      other_checks_not_shown: { total: 12, truncated: false },
      withdrawn_not_shown: 1,
      read: { read: 2, total: 2, truncated: false },
    },
    forecast: unknown("phase_dates_missing"),
    work_units: { read: 4, total: null, truncated: false },
    sources: [
      {
        kind: "coord_document",
        label: "The initiative document",
        version: 2,
        observed_at: OBSERVED_AT,
      },
    ],
    ...over,
  };
}

/** The whole envelope when coord could not be reached and nothing was known. */
export function unreachableEnvelope(
  since = "2026-11-21T10:00:00Z"
): ScheduleEnvelope {
  const u = <T>() => unknown<T>("coord_unreachable", since);
  return envelope({
    programme: u(),
    initiative: { name: null, version: null, starts: u(), ends: u() },
    phases: u(),
    milestones: { items: u(), unreadable_rows: [] },
    gates: {
      items: u(),
      other_checks_not_shown: { total: 0, truncated: false },
      withdrawn_not_shown: 0,
      read: { read: 0, total: null, truncated: false },
    },
    forecast: u(),
    work_units: { read: 0, total: null, truncated: false },
    sources: [],
  });
}

/** A programme-less project: every programme-derived figure unknown, with the
 *  reason that says there is nothing to read rather than that a read failed. */
export function noProgrammeEnvelope(): ScheduleEnvelope {
  return envelope({
    programme: unknown("no_programme"),
    phases: unknown("no_programme"),
    milestones: {
      items: unknown("no_programme"),
      unreadable_rows: [],
    },
    gates: {
      items: unknown("no_programme"),
      other_checks_not_shown: { total: 0, truncated: false },
      withdrawn_not_shown: 0,
      read: { read: 0, total: null, truncated: false },
    },
    forecast: unknown("no_programme"),
  });
}
