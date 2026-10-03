/**
 * How the project's work is progressing, from coord's work units (the plans
 * behind `/api/v1/operations/plans`), in words a business reader uses.
 *
 * Work-unit status is opaque text in coord, so this does NOT keep its own
 * vocabulary: it buckets by the tone the Coord Console already assigns
 * (`describePlanStatus` in `components/admin/coord/planStatus.ts`), so a new
 * status spelling is taught in one place and both surfaces agree.
 *
 * Closed work (superseded, obsolete, archived) will not be done and counts
 * toward nothing. A status nobody recognises is NOT dropped: it is counted as
 * "Status unknown" and stays in the total, so it can only ever pull the done
 * share down, never inflate it.
 */

import {
  describePlanStatus,
  type CoordPlanRow,
  type PlanStatusTone,
} from "@/components/admin/coord/planStatus";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/work-units/plansHealth";

export type ProgressBucket =
  | "done"
  | "in_progress"
  | "ready"
  | "blocked"
  | "planned"
  | "unknown";

export const PROGRESS_BUCKETS: readonly {
  key: ProgressBucket;
  label: string;
}[] = [
  { key: "done", label: "Done" },
  { key: "in_progress", label: "In progress" },
  { key: "ready", label: "Ready to start" },
  { key: "blocked", label: "Blocked" },
  { key: "planned", label: "Planned" },
  { key: "unknown", label: "Status unknown" },
];

const TONE_BUCKET: Record<PlanStatusTone, ProgressBucket | null> = {
  shipped: "done",
  active: "in_progress",
  // `ready` is derived by coord: dependencies met, work NOT yet started.
  ready: "ready",
  blocked: "blocked",
  pending: "planned",
  closed: null,
  unknown: "unknown",
};

export interface FinishedItem {
  title: string;
  finishedAt: string;
}

export interface Progress {
  counts: Record<ProgressBucket, number>;
  /** Every counted unit, including those with an unknown status. */
  total: number;
  /**
   * True when the read may not include every unit (the server returned a
   * full page). Counts are then lower bounds and must be shown as such.
   */
  truncated: boolean;
  /** Most recently finished units, newest first. */
  recentlyFinished: FinishedItem[];
}

/** A readable name for a unit without a title: its slug, minus the date. */
export function titleOf(row: Pick<CoordPlanRow, "slug" | "title">): string {
  const title = row.title?.trim();
  if (title) return title;
  const bare = row.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

type ShippedRow = CoordPlanRow & { first_shipped_at: string };

/** A unit counted as done that also says when it first shipped. A done
 *  unit with no ship date is still done; it just has no day to be placed on. */
function hasShipDate(row: CoordPlanRow): row is ShippedRow {
  return Boolean(row.first_shipped_at);
}

function isWorkUnit(row: CoordPlanRow): boolean {
  return !row.slug.startsWith(SHEPHERD_SLUG_PREFIX);
}

export interface ShippedPlan {
  slug: string;
  title: string;
  /** When the unit first shipped (a timestamp; the day is what is drawn). */
  shippedAt: string;
}

export interface ShippedPlans {
  /** Oldest first, the order a calendar reads in. */
  items: ShippedPlan[];
  /** Done units with no ship date: counted, but with no day to place. */
  undated: number;
  /** As in `Progress`: the read may not hold every unit. */
  truncated: boolean;
}

/**
 * The project's shipped plans for the Timeline's lane: every unit the Coord
 * Console's tone calls shipped, at the day it first shipped, titled by its
 * plan title. Done-ness is the same judgement `summarizeProgress` makes, so
 * the lane and the Summary's "Done" figure count the same units.
 */
export function shippedPlans(
  allRows: CoordPlanRow[],
  { fetchLimit }: { fetchLimit: number }
): ShippedPlans {
  const done = allRows
    .filter(isWorkUnit)
    .filter((r) => TONE_BUCKET[describePlanStatus(r.status).tone] === "done");
  const dated = done.filter(hasShipDate);
  return {
    items: dated
      .sort((a, b) => a.first_shipped_at.localeCompare(b.first_shipped_at))
      .map((r) => ({
        slug: r.slug,
        title: titleOf(r),
        shippedAt: r.first_shipped_at,
      })),
    undated: done.length - dated.length,
    truncated: allRows.length >= fetchLimit,
  };
}

export function summarizeProgress(
  allRows: CoordPlanRow[],
  { fetchLimit, recent = 5 }: { fetchLimit: number; recent?: number }
): Progress {
  // The proxy's server-side exclusion of merge-shepherd bookkeeping units is
  // best-effort, so it is applied again here. Truncation is judged on the
  // rows the server actually returned, before this filter.
  const rows = allRows.filter(isWorkUnit);

  const counts: Record<ProgressBucket, number> = {
    done: 0,
    in_progress: 0,
    ready: 0,
    blocked: 0,
    planned: 0,
    unknown: 0,
  };
  const finished: ShippedRow[] = [];
  for (const row of rows) {
    const bucket = TONE_BUCKET[describePlanStatus(row.status).tone];
    if (bucket === null) continue;
    counts[bucket] += 1;
    if (bucket === "done" && hasShipDate(row)) finished.push(row);
  }

  const recentlyFinished = finished
    .sort((a, b) => b.first_shipped_at.localeCompare(a.first_shipped_at))
    .slice(0, recent)
    .map((r) => ({ title: titleOf(r), finishedAt: r.first_shipped_at }));

  return {
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    truncated: allRows.length >= fetchLimit,
    recentlyFinished,
  };
}
