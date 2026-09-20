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
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/plans/plansHealth";

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

export function summarizeProgress(
  allRows: CoordPlanRow[],
  { fetchLimit, recent = 5 }: { fetchLimit: number; recent?: number }
): Progress {
  // The proxy's server-side exclusion of merge-shepherd bookkeeping units is
  // best-effort, so it is applied again here. Truncation is judged on the
  // rows the server actually returned, before this filter.
  const rows = allRows.filter((r) => !r.slug.startsWith(SHEPHERD_SLUG_PREFIX));

  const counts: Record<ProgressBucket, number> = {
    done: 0,
    in_progress: 0,
    ready: 0,
    blocked: 0,
    planned: 0,
    unknown: 0,
  };
  const finished: (CoordPlanRow & { first_shipped_at: string })[] = [];
  for (const row of rows) {
    const bucket = TONE_BUCKET[describePlanStatus(row.status).tone];
    if (bucket === null) continue;
    counts[bucket] += 1;
    if (bucket === "done" && row.first_shipped_at) {
      finished.push(row as CoordPlanRow & { first_shipped_at: string });
    }
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
