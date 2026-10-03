/**
 * What a Save would DROP from the saved estimate, and what that would cost.
 *
 * A content write replaces the plan; a saved phase that no submitted phase
 * continues is deleted, and with it the progress recorded on the Timeline
 * (actual dates, the gate's outcome and notes), while the milestones tied to
 * it are untied. The commonest way to get there is a re-imported gantt chart
 * that renamed a section's code: the chart cannot carry identity, so its
 * phase is new and the saved one goes.
 *
 * So before Save the editor asks: which saved phases does this write drop
 * (`droppedPhases` — the server's own matching rule, mirrored), and does any
 * of them hold recorded work (`checkDroppedPhases` — read fresh from the
 * `phase-progress` and `milestones` resources at the moment of Save, because
 * a gate may have been recorded on the Timeline since this page loaded)?
 * A check that could not be made is said, never passed silently.
 */

import { listResource } from "@/components/overview/editing/api";
import type { PhaseWrite } from "../../../_lib/estimate-api";
import {
  MILESTONES_PATH,
  PHASE_PROGRESS_PATH,
  type Milestone,
  type PhaseProgress,
} from "../../../_lib/timeline-api";
import { GATE } from "../../../_lib/timeline";

/** A saved phase, as the editor knows it. */
export interface SavedPhase {
  id: string | null;
  code: string;
  name: string;
}

/**
 * The saved phases `submitted` would drop, in their saved order.
 *
 * The rule is `match_phases` in `backend/app/overview/estimates.py`, and the
 * two must agree: a submitted phase naming an id continues THAT phase; then
 * each submitted phase with no id continues the saved phase with its code,
 * among those no id claimed. A saved phase nothing continues is dropped.
 */
export function droppedPhases(
  saved: readonly SavedPhase[],
  submitted: readonly Pick<PhaseWrite, "id" | "code">[]
): SavedPhase[] {
  const claimedIds = new Set(
    submitted.flatMap((phase) => (phase.id ? [phase.id] : []))
  );
  const continued = new Set<SavedPhase>(
    saved.filter((phase) => phase.id !== null && claimedIds.has(phase.id))
  );
  for (const phase of submitted) {
    if (phase.id) continue;
    const byCode = saved.find(
      (old) => old.code === phase.code && !continued.has(old)
    );
    if (byCode) continued.add(byCode);
  }
  return saved.filter((phase) => !continued.has(phase));
}

/** What dropping one phase would cost. */
export interface PhaseLoss {
  phase: SavedPhase;
  /** The recorded progress that would be deleted, in words ("the gate's
   *  outcome (Passed)", "actual start date"); empty when none. */
  progress: string[];
  /** How many milestones would be untied from it. */
  milestones: number;
}

export type DropCheck =
  /** Nothing dropped holds recorded work: save without asking. */
  | { kind: "clear" }
  /** These would lose something: ask first. */
  | { kind: "at_risk"; losses: PhaseLoss[] }
  /** Whether anything would be lost could not be found out: say so, and let
   *  the writer choose. Never treated as "clear". */
  | { kind: "unknown"; dropped: SavedPhase[]; reason: string };

/** The progress a phase holds, in words — empty when nothing is recorded. */
export function recordedProgress(progress: PhaseProgress): string[] {
  const parts: string[] = [];
  if (progress.gate_status !== "pending") {
    parts.push(`gate outcome (${GATE[progress.gate_status].label})`);
  } else if (progress.gate_decided_at) {
    parts.push("gate decision date");
  }
  if (progress.gate_notes.trim() !== "") parts.push("gate notes");
  if (progress.actual_start && progress.actual_end) {
    parts.push("actual start and end dates");
  } else if (progress.actual_start) {
    parts.push("actual start date");
  } else if (progress.actual_end) {
    parts.push("actual end date");
  }
  return parts;
}

/**
 * Each dropped phase that would lose something, from the estimate's
 * progress rows and the project's milestones. A dropped phase with no id (a
 * working copy kept by an older build) is found among the progress rows by
 * its code, which is unique within one estimate.
 */
export function assessDrops(
  dropped: readonly SavedPhase[],
  progress: readonly PhaseProgress[],
  milestones: readonly Milestone[]
): PhaseLoss[] {
  const losses: PhaseLoss[] = [];
  for (const phase of dropped) {
    const row = progress.find((p) =>
      phase.id !== null ? p.id === phase.id : p.code === phase.code
    );
    const id = phase.id ?? row?.id ?? null;
    const recorded = row ? recordedProgress(row) : [];
    const tied =
      id === null ? 0 : milestones.filter((m) => m.phase_id === id).length;
    if (recorded.length > 0 || tied > 0) {
      losses.push({ phase, progress: recorded, milestones: tied });
    }
  }
  return losses;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read, now, what the `dropped` phases of `estimateId` hold. Any read that
 * fails or comes back degraded makes the answer `unknown`, never `clear`.
 */
export async function checkDroppedPhases(
  estimateId: string,
  dropped: readonly SavedPhase[]
): Promise<DropCheck> {
  if (dropped.length === 0) return { kind: "clear" };
  const unknown = (reason: string): DropCheck => ({
    kind: "unknown",
    dropped: [...dropped],
    reason,
  });

  let progress: PhaseProgress[];
  try {
    const body = await listResource<PhaseProgress>(PHASE_PROGRESS_PATH, {
      estimate_id: estimateId,
    });
    if (body.degraded) return unknown(body.degraded);
    progress = body.items;
  } catch (err) {
    return unknown(
      `The phases' recorded progress could not be read: ${message(err)}`
    );
  }

  const ids = dropped.flatMap((phase) => {
    const id =
      phase.id ?? progress.find((p) => p.code === phase.code)?.id ?? null;
    return id === null ? [] : [id];
  });
  let milestones: Milestone[] = [];
  if (ids.length > 0) {
    try {
      const body = await listResource<Milestone>(MILESTONES_PATH, {
        phase_id: ids,
      });
      if (body.degraded) return unknown(body.degraded);
      milestones = body.items;
    } catch (err) {
      return unknown(`The milestones could not be read: ${message(err)}`);
    }
  }

  const losses = assessDrops(dropped, progress, milestones);
  return losses.length === 0 ? { kind: "clear" } : { kind: "at_risk", losses };
}
