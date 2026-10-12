/**
 * The editor's working copy of an estimate, and the conversions around it: a
 * loaded estimate into a draft, a draft into the content a save writes, and a
 * draft into the plain summary the conflict dialog shows beside a peer's.
 *
 * Pure, and deliberately outside the component: the editor holds one plain
 * object, every table edit and import replaces part of it, and saving sends
 * the whole thing. The save itself — `If-Match`, the conflict dialog, the
 * change log — is the overview authoring kit's, not this file's.
 *
 * **Everything this page does not edit still has to travel.** A content write
 * replaces an estimate's WHOLE plan, so any field absent from the payload
 * reverts to its default — for a phase, the gate's criteria and the source
 * plan's stated working weeks, both dropped by one Save on a page that shows
 * neither.
 *
 * The rule, therefore: the draft round-trips every field of every table a
 * content write owns. `DraftPhase` and `DraftTask` below mirror `PhaseWrite`
 * and `TaskWrite` field for field, and the cost lines and calendar breaks are
 * carried verbatim. Adding a field to the wire shape means adding it here too.
 *
 * A phase's PROGRESS — actual dates and the gate's outcome — is not the
 * plan's and is deliberately absent: the Timeline records it through the
 * `phase_progress` resource under its own version, a content write refuses
 * it, and a phase whose code a Save keeps keeps its progress on the server.
 * So no Save here can put back an outcome somebody recorded since the editor
 * loaded, and recording one never makes this page's Save a conflict.
 */

import type {
  ParsedAllocationRow,
  ParsedEffortRow,
  ParsedRoleRow,
} from "../../../_lib/csv";
import { formatMicros } from "@/components/overview/money";
import { sumPersonDays } from "../../../_lib/csv";
import type {
  EstimateContentWrite,
  EstimateRecord,
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
}

const NO_CONTENT: NonNullable<EstimateRecord["content"]> = {
  roles: [],
  phases: [],
  allocations: [],
  price_tiers: [],
  cost_lines: [],
  calendar_breaks: [],
};

/** A record read WITH its content (a single-record read); a list read's
 *  record has none and reads as an empty estimate. */
export function draftFromEstimate(record: EstimateRecord): Draft {
  const detail = record.content ?? NO_CONTENT;
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

  // Two effort rows on the same task and role. Reachable when a re-import
  // removes a task: its rows keep a number that now belongs to a DIFFERENT
  // task, so they land on top of that task's own.
  //
  // This check is deliberately independent of the matcher. Same role, the
  // backend refuses the save with a 422 naming a task the editor never
  // pointed at; different roles, the removed task's days are silently added
  // to whatever took its number — and `draftProblems` could not see either,
  // because it only ever asked whether the key EXISTS.
  //
  // It catches the SAME-ROLE collision. Different roles on one task is a
  // legal shape, so nothing here can distinguish it from an intended entry;
  // that half stays invisible by design.
  const effortSeen = new Set<string>();
  for (const effort of draft.efforts) {
    const key = `${effort.phase_code}:${effort.task_number}:${effort.role_code}`;
    if (effortSeen.has(key)) {
      problems.push({
        severity: "error",
        message: `Task ${effort.task_number} of phase ${effort.phase_code} has two entries for ${effort.role_code}. A re-import usually causes this when a task was removed: check the days table against the phases above.`,
      });
    }
    effortSeen.add(key);
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
  };
}

/** Two drafts say the same thing — the test for "nothing unsaved". */
export function sameDraft(a: Draft, b: Draft): boolean {
  return (
    JSON.stringify(draftToContent(a)) === JSON.stringify(draftToContent(b))
  );
}

/**
 * A draft in plain lines, for the conflict dialog: enough to see what each
 * side holds — every phase, every role and its rate, and how much effort and
 * team each states — without reading a payload.
 */
export function describeDraft(draft: Draft): string {
  const lines: string[] = [];
  lines.push(`Phases (${draft.phases.length}):`);
  for (const phase of draft.phases) {
    lines.push(
      `  ${phase.code} ${phase.name} — ${phase.planned_start ?? "no start"} to ${
        phase.planned_end ?? "no end"
      }, ${phase.tasks.length} task${phase.tasks.length === 1 ? "" : "s"}`
    );
  }
  lines.push(`Roles (${draft.roles.length}):`);
  for (const role of draft.roles) {
    const rate =
      formatMicros(role.day_rate_micros, role.currency, {
        maximumFractionDigits: 2,
      }) ?? "not priced";
    lines.push(
      `  ${role.code} ${role.name} — ${rate}${role.client_side ? " (client’s)" : ""}`
    );
  }
  lines.push(
    `Allocations: ${draft.allocations.length} role-and-phase entr${
      draft.allocations.length === 1 ? "y" : "ies"
    }`
  );
  const days = sumPersonDays(draft.efforts.map((e) => e.planned_person_days));
  lines.push(
    `Days of work: ${days ?? "an unreadable number"} across ${
      draft.efforts.length
    } line${draft.efforts.length === 1 ? "" : "s"}`
  );
  const count = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  lines.push(
    `Also: ${count(draft.priceTiers.length, "price", "prices")}, ${count(
      draft.costLines.length,
      "cost line",
      "cost lines"
    )}, ${count(draft.calendarBreaks.length, "calendar break", "calendar breaks")}`
  );
  return lines.join("\n");
}

/** Everything of a phase's plan that this page never edits. */
const PHASE_CARRIED = ["stated_working_weeks", "gate_criteria"] as const;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Something a merge could not settle, which the writer must. A note about one
 * of my day rows carries that row: it is settled once the working copy no
 * longer holds the row exactly as flagged (it was edited or removed), or when
 * the writer says they have checked it and it is right as it stands. A note
 * about the whole merge (`row: null`) is settled only by that check.
 */
export interface MergeNote {
  message: string;
  row: ParsedEffortRow | null;
}

/** The notes still open against `draft`, in their order. */
export function openMergeNotes(notes: MergeNote[], draft: Draft): MergeNote[] {
  return notes.filter(
    (note) =>
      note.row === null ||
      draft.efforts.some((effort) => same(effort, note.row))
  );
}

export interface Rebased {
  /** My working copy rebuilt on their version. */
  draft: Draft;
  /**
   * Why `draft` cannot be saved over theirs as it stands — each a sentence a
   * writer can act on. Non-empty means "keep mine" must not be applied
   * automatically: the writer combines the two by hand instead, and each
   * note holds Save until it is settled.
   */
  unresolved: MergeNote[];
}

/**
 * My working copy, rebuilt on THEIR version: what saving it over theirs
 * should write. A three-way merge against the version mine was built on
 * (`base`), so that a save after a conflict replaces only what I changed:
 *
 * - every table I did not touch takes theirs — including the ones this page
 *   only carries (prices, cost lines, calendar breaks), which a peer (the
 *   Timeline, an agent) may well have changed;
 * - a table I did change keeps mine;
 * - the phases: untouched, theirs; re-imported, my schedule — but each
 *   phase's gate criteria and stated weeks still come from theirs by code,
 *   since this page never edits those (and its progress is not in the draft
 *   at all — the server keeps it);
 * - my days of work, when THEY changed the schedule and I did not: each row
 *   names a task by its number, and their re-import may have renumbered the
 *   tasks, so every row is carried to the task it was written against
 *   (matched as `applyGanttImport` matches, by title first). A row of mine
 *   whose task cannot be found unambiguously in theirs is NOT guessed at: it
 *   is reported in `unresolved`, and the writer combines by hand. An
 *   untouched row whose task they removed goes with the task.
 *
 * Without it, "keep mine" would silently put back the old copy of every
 * field the dialog does not even show, or file my days under other tasks.
 */
export function rebaseDraft(mine: Draft, base: Draft, theirs: Draft): Rebased {
  const pick = <K extends keyof Draft>(part: K): Draft[K] =>
    same(mine[part], base[part]) ? theirs[part] : mine[part];
  const mySchedule = !same(mine.phases, base.phases);
  const phases = !mySchedule
    ? theirs.phases
    : mine.phases.map((phase) => {
        const their = theirs.phases.find((t) => t.code === phase.code);
        if (!their) return phase;
        const carried = Object.fromEntries(
          PHASE_CARRIED.map((field) => [field, their[field]])
        ) as Pick<DraftPhase, (typeof PHASE_CARRIED)[number]>;
        return { ...phase, ...carried };
      });

  const unresolved: MergeNote[] = [];
  let efforts = pick("efforts");
  const theirSchedule = !same(theirs.phases, base.phases);
  if (!mySchedule && theirSchedule && !same(mine.efforts, base.efforts)) {
    // base task -> their task, per phase, and whether the pairing is proven
    // by the title (a positional pairing is a guess at a rename).
    const moved = new Map<string, { to: string; byTitle: boolean }>();
    for (const their of theirs.phases) {
      const was = base.phases.find((p) => p.code === their.code);
      if (!was) continue;
      matchTasks(was.tasks, their.tasks).forEach((old, index) => {
        const to = their.tasks[index];
        if (old && to) {
          moved.set(`${their.code}:${old.number}`, {
            to: to.number,
            byTitle: old.title === to.title,
          });
        }
      });
    }
    const untouched = new Set(base.efforts.map((e) => JSON.stringify(e)));
    efforts = [];
    for (const row of mine.efforts) {
      const edited = !untouched.has(JSON.stringify(row));
      const target = moved.get(`${row.phase_code}:${row.task_number}`);
      if (target && (target.byTitle || !edited)) {
        efforts.push({ ...row, task_number: target.to });
      } else if (edited) {
        unresolved.push({
          message: `Your days for task ${row.task_number} of phase ${row.phase_code} (${row.role_code}) can't be matched to a task in their schedule, which they changed. Edit or remove that row, or mark it checked if it is right as it stands.`,
          row,
        });
        efforts.push(row);
      }
      // An untouched row whose task they removed goes with the task.
    }
  }

  if (mySchedule && theirSchedule && !same(theirs.efforts, base.efforts)) {
    // Both of us re-imported the schedule. Mine is kept, but their days of
    // work were written against THEIR tasks, which mine replaces: nothing
    // can say which of my tasks each of their rows belongs to.
    unresolved.push({
      message:
        "You and they both changed the schedule, and they also changed the days of work, which were written against their tasks. Check the days table against your schedule, then mark this checked.",
      row: null,
    });
  }

  return {
    draft: {
      roles: pick("roles"),
      phases,
      allocations: pick("allocations"),
      efforts,
      priceTiers: pick("priceTiers"),
      costLines: pick("costLines"),
      calendarBreaks: pick("calendarBreaks"),
    },
    unresolved,
  };
}

/**
 * Whether "keep mine" can be applied as it stands: the reasons it cannot —
 * rows that could not be carried over, and anything the merged copy would be
 * refused for (my removed role still named by their days, say). Empty means
 * it can be saved.
 */
export function keepMineBlockers(rebased: Rebased): string[] {
  return [
    ...rebased.unresolved.map((note) => note.message),
    ...draftProblems(rebased.draft)
      .filter((p) => p.severity === "error")
      .map((p) => p.message),
  ];
}

/**
 * For each imported task, which saved task it continues — or `undefined` for
 * one the chart has just introduced.
 *
 * Neither key alone works. A NUMBER encodes position (`ganttToPhases` builds
 * it as `<phase index>.<task index>`), so inserting one task or one section
 * renumbers everything below and hands each saved row to the task that took
 * its place — a wrong requirement reference reads as an authored one. A
 * TITLE is stable across insertion but not unique: two tasks called "Review"
 * both matched the first, so one lost its refs and the other gained refs it
 * never had. And a title is not stable across a rename, where position is.
 *
 * So it is TWO passes. Every exact title is paired first, in order, each
 * saved task claimed at most once. A single pass — title, else position,
 * per task — looks equivalent and is not: the inserted task reaches
 * position 0 before the real owner of that title has had its turn, and
 * walks off with its refs.
 *
 * The positional second pass then runs ONLY when the two lists are the same
 * LENGTH. Say what that does and does not mean, because an earlier wording
 * here claimed more than the code delivers:
 *
 * - It is not "nothing was inserted or removed". It is "the COUNT did not
 *   change", which also covers one removal and one insertion in the same
 *   import. In that case the rule resolves the pair as a RENAME, and a
 *   brand-new task inherits the removed task's refs and person-days.
 * - That case is genuinely undecidable, not merely unhandled: `[A, B, C]`
 *   becoming `[A, X, C]` is the same text whether B was renamed to X or
 *   removed and replaced by it. Any rule that got it "right" for one reading
 *   would be wrong for the other, so a gap-constrained pairing resolves it
 *   identically. Resolving it as a rename is the choice, and it is the one
 *   that preserves work more often.
 *
 * What the length gate DOES buy is that an edit which changes the count —
 * the common shape, and the one three review passes found defects in —
 * carries what the titles prove and nothing else.
 *
 * It is the third attempt at this rule:
 *
 * - Position first lost every ref below an insertion, or handed each one to
 *   the task that took its place.
 * - Title only, with an unconstrained positional fallback, was worse: with
 *   an insertion AND a rename in one import, a brand-new task took the
 *   renamed one's refs and its person-days. `index` is the IMPORTED index
 *   compared against the RAW saved index, so it is wrong by exactly the
 *   shift the pass-1 anchors prove happened.
 *
 * A gap-constrained pairing would recover some of those cases. It is not
 * worth it: the failure it would avoid is a LOST ref, which is visible and
 * re-enterable, while the failure it risks is a MIS-ATTRIBUTED one, which
 * reads as authored data and is not. When the lists differ in length, this
 * carries what the titles prove and nothing else.
 */
function matchTasks(
  saved: DraftTask[],
  imported: { number: string; title: string }[]
): (DraftTask | undefined)[] {
  const matched: (DraftTask | undefined)[] = imported.map(() => undefined);
  const claimed = new Set<string>();

  imported.forEach((task, index) => {
    const byTitle = saved.find(
      (old) => old.title === task.title && !claimed.has(old.number)
    );
    if (byTitle) {
      matched[index] = byTitle;
      claimed.add(byTitle.number);
    }
  });

  // The COUNT is unchanged — which includes a one-in-one-out edit, resolved
  // here as a rename because it is indistinguishable from one. See the
  // docstring; this is a weaker guarantee than "nothing was inserted".
  if (saved.length === imported.length) {
    imported.forEach((_task, index) => {
      if (matched[index] !== undefined) return;
      const atSamePlace = saved[index];
      if (atSamePlace && !claimed.has(atSamePlace.number)) {
        matched[index] = atSamePlace;
        claimed.add(atSamePlace.number);
      }
    });
  }

  return matched;
}

/**
 * Apply an imported schedule to the working copy.
 *
 * Pure, and out of the component on purpose: this is the one place a
 * re-import can lose something, and inline in a JSX callback it was the one
 * place no test could reach.
 *
 * A chart states the SCHEDULE and nothing else. Everything it cannot express
 * is carried across from the row that matches — a phase by its CODE, and a
 * task by its TITLE (its number encodes position in the chart, so it moves
 * whenever anything is inserted above it). A phase's gate, its actual dates
 * and the working weeks the source plan stated come across, and so do a
 * task's requirement refs, which are one level down and were being nulled on
 * every re-import. A phase the chart does not mention is dropped, which is
 * what importing a corrected schedule means.
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
  // Old task number -> new task number, per phase, built from the same
  // matcher the refs use. Effort rows are keyed `phase_code` + `task_number`
  // (`parseEffortsCsv`), and that number moves on every insertion just as
  // the refs' did — so without this remap the days authored against
  // "Kick-off" silently became the days of whatever task took its place.
  // `draftProblems` could not see it either: the key still existed, so there
  // was no error, no warning and no visible change. Requirement refs were
  // the smaller half of that defect; this is the money.
  const renumbered = new Map<string, string>();
  for (const phase of imported) {
    const existing = draft.phases.find((old) => old.code === phase.code);
    matchTasks(existing?.tasks ?? [], phase.tasks).forEach((old, index) => {
      const to = phase.tasks[index];
      if (old && to && old.number !== to.number) {
        renumbered.set(`${phase.code}:${old.number}`, to.number);
      }
    });
  }
  // Rows whose phase the chart dropped are NOT deleted here. Deleting them
  // would be the same silent loss this function exists to stop, one table
  // over — and unlike a renumber, it is not something the import can know
  // the reader wants. They are left dangling for `draftProblems` to name,
  // exactly as the allocation rows are, and the save is blocked until the
  // tables agree again.
  return {
    ...draft,
    efforts: draft.efforts.map((effort) => {
      const to = renumbered.get(`${effort.phase_code}:${effort.task_number}`);
      return to === undefined ? effort : { ...effort, task_number: to };
    }),
    phases: imported.map((phase) => {
      const existing = draft.phases.find((old) => old.code === phase.code);
      // Each saved task is claimed at most once, so two tasks sharing a
      // title cannot both take the first one's refs.
      const continues = matchTasks(existing?.tasks ?? [], phase.tasks);
      return {
        code: phase.code,
        name: phase.name,
        planned_start: phase.planned_start,
        planned_end: phase.planned_end,
        stated_working_weeks: existing?.stated_working_weeks ?? null,
        gate_criteria: existing?.gate_criteria ?? "",
        tasks: phase.tasks.map((task, index) => ({
          number: task.number,
          title: task.title,
          requirement_refs: continues[index]?.requirement_refs ?? null,
          planned_start: task.planned_start,
          planned_end: task.planned_end,
          is_critical: task.is_critical,
          status: task.status,
        })),
      };
    }),
  };
}

/** The parts of a working copy a writer can take from a peer's version. */
export type DraftPart = "schedule" | "roles" | "allocations" | "efforts";

/**
 * `mine` with one part replaced by `theirs`' — how a writer combines two
 * versions after a conflict, table by table, before saving. The schedule is
 * the phases with their tasks; the days stay with `efforts`, so taking their
 * schedule can leave my days naming tasks theirs does not have, which
 * `draftProblems` then names before Save.
 */
export function takePart(mine: Draft, theirs: Draft, part: DraftPart): Draft {
  switch (part) {
    case "schedule":
      return { ...mine, phases: theirs.phases };
    case "roles":
      return { ...mine, roles: theirs.roles };
    case "allocations":
      return { ...mine, allocations: theirs.allocations };
    case "efforts":
      return { ...mine, efforts: theirs.efforts };
  }
}

/** A working copy as this device keeps it between visits. */
/** Bumped whenever `Draft` changes shape: a copy kept by an older build is
 *  dropped rather than saved with fields it never had (which would reset
 *  them to their defaults on the server). */
export const STORED_DRAFT_SCHEMA = 1;

export interface StoredDraft {
  schema: typeof STORED_DRAFT_SCHEMA;
  draft: Draft;
  /** The estimate as it was when the working copy was started, so a save
   *  that meets a newer version can merge three ways (`rebaseDraft`). */
  base: Draft;
  /** Whether it holds an import, so its save is recorded as one. */
  imported: boolean;
  /** What a "combine" left for the writer to settle, so a reload still says
   *  why Save is held. */
  notes?: MergeNote[];
}

export function draftToStorage(stored: StoredDraft): string {
  return JSON.stringify(stored);
}

/**
 * A stored working copy, or null when there is none or it is not one this
 * editor can use (written by an older build, or damaged). Storage is the
 * device's, so nothing read from it is trusted to have the right shape.
 */
export function draftFromStorage(text: string): StoredDraft | null {
  const lists: (keyof Draft)[] = [
    "roles",
    "phases",
    "allocations",
    "efforts",
    "priceTiers",
    "costLines",
    "calendarBreaks",
  ];
  const isDraft = (value: unknown): value is Draft =>
    typeof value === "object" &&
    value !== null &&
    lists.every((name) => Array.isArray((value as Partial<Draft>)[name]));
  try {
    const parsed = JSON.parse(text) as Partial<StoredDraft>;
    if (
      parsed.schema !== STORED_DRAFT_SCHEMA ||
      !isDraft(parsed.draft) ||
      !isDraft(parsed.base)
    ) {
      return null;
    }
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter(
          (n): n is MergeNote =>
            typeof n === "object" &&
            n !== null &&
            typeof n.message === "string" &&
            (n.row === null || (typeof n.row === "object" && n.row !== null))
        )
      : [];
    return {
      schema: STORED_DRAFT_SCHEMA,
      draft: parsed.draft,
      base: parsed.base,
      imported: parsed.imported === true,
      notes,
    };
  } catch {
    return null;
  }
}
