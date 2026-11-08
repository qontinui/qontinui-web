/**
 * A synthetic schedule for the blocks that show the Timeline elsewhere
 * (`overview-kpi`, `overview-timeline`, `overview-plan-vs-actual`), in the
 * Timeline's own shapes — modelled on `timeline/page.test.tsx`'s fixture.
 *
 * Three phases: A0 finished on plan, A1 under way and forecast late, A2 not
 * started. Today, as the server takes it, is 2026-02-16.
 */

import type { EstimateRecord } from "@/app/(app)/overview/_lib/estimate-api";
import type {
  Milestone,
  PhaseProgress,
  TimelineForecast,
} from "@/app/(app)/overview/_lib/timeline-api";

const PLAN = [
  ["ph0", "A0", "Mobilisation", "2026-01-05", "2026-01-30"],
  ["ph1", "A1", "Discovery", "2026-02-02", "2026-02-27"],
  ["ph2", "A2", "Build", "2026-03-02", "2026-03-27"],
] as const;

export const ESTIMATE: EstimateRecord = {
  id: "e1",
  name: "Estimate v0.1",
  purpose: "budget",
  status: "approved",
  is_baseline: true,
  source_page_id: null,
  accuracy_note: null,
  contingency_pct: null,
  notes: "",
  version: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by: null,
  updated_by: null,
  content: {
    roles: [],
    phases: PLAN.map(([id, code, name, start, end], index) => ({
      id,
      code,
      name,
      sort_order: index,
      planned_start: start,
      planned_end: end,
      stated_working_weeks: null,
      gate_criteria: `Gate ${code}`,
      actual_start: null,
      actual_end: null,
      gate_status: "pending" as const,
      gate_decided_at: null,
      gate_notes: "",
      tasks: [],
    })),
    allocations: [],
    price_tiers: [],
    cost_lines: [],
    calendar_breaks: [],
  },
};

export function progress(
  index: 0 | 1 | 2,
  over: Partial<PhaseProgress> = {}
): PhaseProgress {
  const [id, code, name, start, end] = PLAN[index];
  return {
    id,
    estimate_id: "e1",
    code,
    name,
    sort_order: index,
    planned_start: start,
    planned_end: end,
    gate_criteria: `Gate ${code}`,
    actual_start: null,
    actual_end: null,
    gate_status: "pending",
    gate_decided_at: null,
    gate_notes: "",
    version: 1,
    updated_at: null,
    updated_by: null,
    ...over,
  };
}

export const PROGRESS: PhaseProgress[] = [
  progress(0, {
    actual_start: "2026-01-05",
    actual_end: "2026-01-30",
    gate_status: "passed",
    gate_decided_at: "2026-01-30",
  }),
  progress(1, { actual_start: "2026-02-02" }),
  progress(2),
];

export const MILESTONES: Milestone[] = [];

export const FORECAST: TimelineForecast = {
  estimate_id: "e1",
  estimate_version: 3,
  today: "2026-02-16",
  planned_start: "2026-01-05",
  planned_finish: "2026-03-27",
  calendar_weeks: "12",
  working_weeks: "12",
  position: "in_progress",
  current_phase: { id: "ph1", code: "A1", name: "Discovery" },
  next_phase: { id: "ph2", code: "A2", name: "Build" },
  next_gate: { id: "ph1", code: "A1", name: "Discovery", criteria: "Gate A1" },
  forecast_finish: "2026-04-17",
  slip_days: 21,
  phases: [
    {
      id: "ph0",
      code: "A0",
      name: "Mobilisation",
      state: "done",
      forecast_start: "2026-01-05",
      forecast_end: "2026-01-30",
      start_slip_days: 0,
      finish_slip_days: 0,
    },
    {
      id: "ph1",
      code: "A1",
      name: "Discovery",
      state: "in_progress",
      forecast_start: "2026-02-02",
      forecast_end: "2026-03-20",
      start_slip_days: 0,
      finish_slip_days: 21,
    },
    {
      id: "ph2",
      code: "A2",
      name: "Build",
      state: "not_started",
      forecast_start: "2026-03-23",
      forecast_end: "2026-04-17",
      start_slip_days: 21,
      finish_slip_days: 21,
    },
  ],
  unavailable: [],
};

/** The overview's own list reads, as the Timeline makes them. */
export function serveSchedule(
  listResource: {
    mockImplementation: (fn: (path: string) => unknown) => unknown;
  },
  {
    estimates = [ESTIMATE],
    phases = PROGRESS,
    milestones = MILESTONES,
  }: {
    estimates?: EstimateRecord[];
    phases?: PhaseProgress[];
    milestones?: Milestone[];
  } = {}
): void {
  listResource.mockImplementation(async (path: string) => {
    const items =
      path === "estimates"
        ? estimates
        : path === "phase-progress"
          ? phases
          : path === "milestones"
            ? milestones
            : [];
    return { items, total: items.length, can_edit: false, degraded: null };
  });
}
