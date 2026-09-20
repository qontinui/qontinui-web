/**
 * The editor's working copy of an estimate, and the two conversions around
 * it: a loaded estimate into a draft, and a draft into the content payload.
 *
 * Pure, and deliberately outside the component: the editor holds one plain
 * object, every import replaces part of it, and saving sends the whole thing.
 * There is no autosave, no per-field PATCH and no conflict-resolution scheme
 * here — the shared overview authoring layer (plan
 * `2026-09-20-overview-authoring-layer`) owns all of that, and duplicating it
 * now would mean deleting it later.
 *
 * **Everything this page does not edit still has to travel.** The content
 * endpoint replaces an estimate's WHOLE graph, so any field absent from the
 * payload reverts to its default — which for a phase means every gate reset
 * to `pending`, gate notes and decision dates blanked, actual dates cleared
 * and the source plan's stated working weeks dropped, all from one Save on a
 * page that shows none of them. The Timeline page (Phase 3) writes exactly
 * those fields, so this is a live cross-page data-loss path rather than a
 * hypothetical one.
 *
 * The rule, therefore: the draft round-trips every field of every table the
 * content endpoint owns. `DraftPhase` and `DraftTask` below mirror
 * `PhaseWrite` and `TaskWrite` field for field, and the cost lines and
 * calendar breaks are carried verbatim. Adding a field to the wire shape
 * means adding it here too.
 */

import type {
  ParsedAllocationRow,
  ParsedEffortRow,
  ParsedRoleRow,
} from "../../../_lib/csv";
import type {
  EstimateContentWrite,
  EstimateDetail,
  GateStatus,
  PhaseWrite,
  RoleWrite,
} from "../../../_lib/estimate-api";

/** Mirrors `TaskWrite` field for field — see the module docstring. */
export interface DraftTask {
  number: string;
  title: string;
  requirement_refs: string | null;
  planned_start: string | null;
  planned_end: string | null;
  is_critical: boolean;
  status: "planned" | "in_progress" | "done";
}

/** Mirrors `PhaseWrite` field for field — see the module docstring. */
export interface DraftPhase {
  code: string;
  name: string;
  planned_start: string | null;
  planned_end: string | null;
  stated_working_weeks: string | null;
  gate_criteria: string;
  actual_start: string | null;
  actual_end: string | null;
  gate_status: GateStatus;
  gate_decided_at: string | null;
  gate_notes: string;
  tasks: DraftTask[];
}

export interface Draft {
  roles: ParsedRoleRow[];
  phases: DraftPhase[];
  allocations: ParsedAllocationRow[];
  efforts: ParsedEffortRow[];
  priceTiers: { name: string; multiplier: string; is_primary: boolean }[];
  /** Carried, not edited — see the module docstring. */
  costLines: EstimateContentWrite["cost_lines"];
  /** Carried, not edited. */
  calendarBreaks: EstimateContentWrite["calendar_breaks"];
  /** The version the draft was loaded from, for optimistic concurrency. */
  version: number;
}

export function draftFromEstimate(detail: EstimateDetail): Draft {
  return {
    roles: detail.roles.map((r) => ({
      code: r.code,
      name: r.name,
      responsibility: r.responsibility,
      day_rate_micros: r.day_rate_micros,
      currency: r.currency,
      client_side: r.client_side,
    })),
    phases: detail.phases.map((p) => ({
      code: p.code,
      name: p.name,
      planned_start: p.planned_start,
      planned_end: p.planned_end,
      stated_working_weeks: p.stated_working_weeks,
      gate_criteria: p.gate_criteria,
      actual_start: p.actual_start,
      actual_end: p.actual_end,
      gate_status: p.gate_status,
      gate_decided_at: p.gate_decided_at,
      gate_notes: p.gate_notes,
      tasks: p.tasks.map((t) => ({
        number: t.number,
        title: t.title,
        requirement_refs: t.requirement_refs,
        planned_start: t.planned_start,
        planned_end: t.planned_end,
        is_critical: t.is_critical,
        status: t.status,
      })),
    })),
    allocations: detail.allocations.map((a) => ({
      phase_code: a.phase_code,
      role_code: a.role_code,
      fte: a.fte,
    })),
    efforts: detail.phases.flatMap((phase) =>
      phase.tasks.flatMap((task) =>
        task.efforts.map((effort) => ({
          phase_code: phase.code,
          task_number: task.number,
          role_code: effort.role_code,
          planned_person_days: effort.planned_person_days,
        }))
      )
    ),
    priceTiers: detail.price_tiers.map((t) => ({
      name: t.name,
      multiplier: t.multiplier,
      is_primary: t.is_primary,
    })),
    costLines: detail.cost_lines.map((c) => ({
      kind: c.kind,
      label: c.label,
      basis: c.basis,
      low_micros: c.low_micros,
      high_micros: c.high_micros,
      currency: c.currency,
      phase_code: c.phase_code,
      run_model: c.run_model,
    })),
    calendarBreaks: detail.calendar_breaks.map((b) => ({
      label: b.label,
      start_date: b.start_date,
      end_date: b.end_date,
    })),
    version: detail.estimate.version,
  };
}

export interface DraftProblem {
  severity: "error" | "warning";
  message: string;
}

/**
 * What the draft would be rejected for, and what saving it would quietly
 * change. The server checks all of this too — this exists so the reader is
 * told BEFORE they press Save, not instead of the server checking.
 */
export function draftProblems(draft: Draft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const roleCodes = new Set(draft.roles.map((r) => r.code));
  const phaseCodes = new Set(draft.phases.map((p) => p.code));

  for (const allocation of draft.allocations) {
    if (!roleCodes.has(allocation.role_code)) {
      problems.push({
        severity: "error",
        message: `The allocation table gives time to "${allocation.role_code}", which is not one of the roles below.`,
      });
    }
    if (!phaseCodes.has(allocation.phase_code)) {
      problems.push({
        severity: "error",
        message: `The allocation table names phase "${allocation.phase_code}", which this estimate does not have.`,
      });
    }
  }

  const taskKeys = new Set(
    draft.phases.flatMap((phase) =>
      phase.tasks.map((task) => `${phase.code}:${task.number}`)
    )
  );
  for (const effort of draft.efforts) {
    if (!roleCodes.has(effort.role_code)) {
      problems.push({
        severity: "error",
        message: `The days table gives work to "${effort.role_code}", which is not one of the roles below.`,
      });
    } else if (!taskKeys.has(`${effort.phase_code}:${effort.task_number}`)) {
      problems.push({
        severity: "error",
        message: `The days table names task ${effort.task_number} of phase ${effort.phase_code}, which this estimate does not have.`,
      });
    }
  }

  if (draft.priceTiers.length > 0) {
    const primaries = draft.priceTiers.filter((t) => t.is_primary).length;
    if (primaries !== 1) {
      problems.push({
        severity: "error",
        message:
          "Exactly one price has to be the primary one — the rates as entered. The others are ratios of it.",
      });
    }
  }

  for (const line of draft.costLines) {
    if (line.phase_code && !phaseCodes.has(line.phase_code)) {
      problems.push({
        severity: "warning",
        message: `The cost "${line.label}" was attached to phase ${line.phase_code}, which no longer exists. Saving will keep the cost but detach it from any phase.`,
      });
    }
  }

  // The same missing role in twenty rows is one problem, not twenty.
  const seen = new Set<string>();
  return problems.filter((p) => {
    if (seen.has(p.message)) return false;
    seen.add(p.message);
    return true;
  });
}

export function draftToContent(draft: Draft): EstimateContentWrite {
  const roles: RoleWrite[] = draft.roles.map((r) => ({
    code: r.code,
    name: r.name,
    responsibility: r.responsibility,
    day_rate_micros: r.day_rate_micros,
    currency: r.currency,
    client_side: r.client_side,
  }));

  const effortsByTask = new Map<
    string,
    { role_code: string; planned_person_days: string }[]
  >();
  for (const effort of draft.efforts) {
    const key = `${effort.phase_code}:${effort.task_number}`;
    const list = effortsByTask.get(key) ?? [];
    list.push({
      role_code: effort.role_code,
      planned_person_days: effort.planned_person_days,
    });
    effortsByTask.set(key, list);
  }

  const phaseCodes = new Set(draft.phases.map((p) => p.code));
  const phases: PhaseWrite[] = draft.phases.map((phase) => ({
    code: phase.code,
    name: phase.name,
    planned_start: phase.planned_start,
    planned_end: phase.planned_end,
    stated_working_weeks: phase.stated_working_weeks,
    gate_criteria: phase.gate_criteria,
    actual_start: phase.actual_start,
    actual_end: phase.actual_end,
    gate_status: phase.gate_status,
    gate_decided_at: phase.gate_decided_at,
    gate_notes: phase.gate_notes,
    tasks: phase.tasks.map((task) => ({
      number: task.number,
      title: task.title,
      requirement_refs: task.requirement_refs,
      planned_start: task.planned_start,
      planned_end: task.planned_end,
      is_critical: task.is_critical,
      status: task.status,
      efforts: effortsByTask.get(`${phase.code}:${task.number}`) ?? [],
    })),
  }));

  return {
    roles,
    phases,
    allocations: draft.allocations.map((a) => ({
      phase_code: a.phase_code,
      role_code: a.role_code,
      fte: a.fte,
    })),
    price_tiers: draft.priceTiers,
    cost_lines: draft.costLines.map((line) => ({
      ...line,
      // A phase the import removed would make the whole save a 422, so the
      // cost survives and loses its phase instead. `draftProblems` warns
      // about this before Save, so it is never a surprise.
      phase_code:
        line.phase_code && phaseCodes.has(line.phase_code)
          ? line.phase_code
          : null,
    })),
    calendar_breaks: draft.calendarBreaks,
    expected_version: draft.version,
  };
}

/**
 * Apply an imported schedule to the working copy.
 *
 * Pure, and out of the component on purpose: this is the one place a
 * re-import can lose something, and inline in a JSX callback it was the one
 * place no test could reach.
 *
 * A chart states the SCHEDULE and nothing else. Everything it cannot express
 * is carried across from the row of the same code — a phase's gate, its
 * actual dates and the working weeks the source plan stated, and a task's
 * requirement refs, which are one level down and were being nulled on every
 * re-import. A phase the chart does not mention is dropped, which is what
 * importing a corrected schedule means.
 */
export function applyGanttImport(
  draft: Draft,
  imported: {
    code: string;
    name: string;
    planned_start: string | null;
    planned_end: string | null;
    tasks: {
      number: string;
      title: string;
      planned_start: string;
      planned_end: string;
      is_critical: boolean;
      status: DraftTask["status"];
    }[];
  }[]
): Draft {
  return {
    ...draft,
    phases: imported.map((phase) => {
      const existing = draft.phases.find((old) => old.code === phase.code);
      return {
        code: phase.code,
        name: phase.name,
        planned_start: phase.planned_start,
        planned_end: phase.planned_end,
        stated_working_weeks: existing?.stated_working_weeks ?? null,
        gate_criteria: existing?.gate_criteria ?? "",
        actual_start: existing?.actual_start ?? null,
        actual_end: existing?.actual_end ?? null,
        gate_status: existing?.gate_status ?? "pending",
        gate_decided_at: existing?.gate_decided_at ?? null,
        gate_notes: existing?.gate_notes ?? "",
        tasks: phase.tasks.map((task) => ({
          number: task.number,
          title: task.title,
          requirement_refs:
            existing?.tasks.find((old) => old.number === task.number)
              ?.requirement_refs ?? null,
          planned_start: task.planned_start,
          planned_end: task.planned_end,
          is_critical: task.is_critical,
          status: task.status,
        })),
      };
    }),
  };
}
