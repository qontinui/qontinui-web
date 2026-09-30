/**
 * How the project's work is progressing, in words a business reader uses.
 *
 * ## One definition of the count, shared with the operator
 *
 * The counts come from coord's project-state door
 * (`GET /api/v1/operations/project-state`, `on_track.totals`) — the SAME
 * numbers the operator's `/admin/coord/home` shows and the
 * `coord_project_state` MCP tool serves (plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4). Until that plan this page bucketed a 500-row page of
 * `/operations/plans` client-side — a second definition of the count, computed
 * in TSX over a read that silently truncated at 500 rows. The door counts every
 * work unit exactly once in SQL, and asserts the classes sum to the total.
 *
 * ## The mapping, door class → the words on this page
 *
 * | door class              | bucket        | why |
 * |-------------------------|---------------|-----|
 * | `shipped`               | Done          | |
 * | `in_flight`             | In progress   | |
 * | `stalled`               | In progress   | still in progress; "no recorded change in 14 days" is the operator's measurement, not a business state |
 * | `blocked_on_dependency` | Blocked       | waiting on other work first |
 * | `waiting_on_gate`       | Blocked       | waiting on a condition before it can move |
 * | `not_started`           | Planned       | draft, vetted or ready — not started |
 * | `closed_other`          | (not counted) | superseded or obsolete: it will not be done, so it counts toward nothing |
 * | `off_vocabulary`        | Status unknown| kept in the total, so it can only pull the done share down |
 * | `unset`                 | Status unknown| same |
 *
 * The old "Ready to start" bucket is gone: the door does not separate a
 * not-started unit whose dependencies are met from one that is merely planned,
 * and rendering a bucket with no source would be a fabricated zero.
 *
 * ## This is a BEHAVIOUR CHANGE, not a like-for-like swap
 *
 * The count this replaced bucketed by the console's status TONE
 * (`describePlanStatus`), which reads more spellings than the door's
 * eight-word vocabulary does. So for the same corpus the two can differ:
 *
 * - `archived` was a closed tone (counted toward nothing); the door has no
 *   `archived` word, so such a unit reads `off_vocabulary` → Status unknown.
 * - `partial` and `in-progress` were active (In progress), and
 *   `vetted_unattested` was pending (Planned); the door reads each as
 *   `off_vocabulary` → Status unknown unless and until coord classifies those
 *   spellings itself (in flight at authoring). Status unknown stays in the
 *   total, so this can lower the done share but never raise it.
 * - A status with padding or mixed case (`"  Shipped "`) was normalised
 *   client-side; the door classifies the stored value as it is.
 * - Merge-shepherd bookkeeping units (`shepherd-*`) were excluded client-side
 *   by slug. The door now excludes them itself and says how many in
 *   `totals.excluded.merge_shepherd_bookkeeping` (and in its `does_not_know`
 *   `work_units` row); the panel's caveat line states that count when it is
 *   above zero. A door predating that exclusion counts them as
 *   `off_vocabulary` → Status unknown.
 * - The old count was bounded by a 500-row page; the door's is not.
 *
 * ## Unknown is not zero
 *
 * When the door's `on_track` block is anything but `read`, there are no counts
 * — {@link progressFromOnTrack} returns `counted: false` and the panel says
 * the progress is unknown rather than showing zeros.
 *
 * "Recently finished" is a separate, narrower read (shipped units only, for
 * their titles and finish dates), which the door does not serve.
 */

import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import {
  UNIT_CLASSES,
  type OnTrackView,
  type UnitClass,
} from "@/components/admin/coord/coordHomeStatus";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/work-units/plansHealth";

export type ProgressBucket =
  | "done"
  | "in_progress"
  | "blocked"
  | "planned"
  | "unknown";

export const PROGRESS_BUCKETS: readonly {
  key: ProgressBucket;
  label: string;
}[] = [
  { key: "done", label: "Done" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "planned", label: "Planned" },
  { key: "unknown", label: "Status unknown" },
];

/** The door class → bucket mapping; see the table in the module doc. */
export const CLASS_BUCKET: Readonly<Record<UnitClass, ProgressBucket | null>> =
  {
    shipped: "done",
    in_flight: "in_progress",
    stalled: "in_progress",
    blocked_on_dependency: "blocked",
    waiting_on_gate: "blocked",
    not_started: "planned",
    closed_other: null,
    off_vocabulary: "unknown",
    unset: "unknown",
  };

export interface FinishedItem {
  title: string;
  finishedAt: string;
}

export interface RecentlyFinished {
  items: FinishedItem[];
  /**
   * The read returned a full page, so a more recently finished unit may be
   * missing from it. The list is then "some recently finished work".
   */
  partial: boolean;
}

export interface Progress {
  counts: Record<ProgressBucket, number>;
  /** Every counted unit, including those with an unknown status. */
  total: number;
  /** Most recently finished units, newest first; null = could not be read. */
  recentlyFinished: RecentlyFinished | null;
  /** Bookkeeping units the door left out of every count; null = not stated. */
  excludedBookkeeping: number | null;
}

export type ProgressReading =
  | { counted: true; progress: Progress }
  | { counted: false; reason: string };

/**
 * Bucket the door's `on_track.totals`. Counts only from a `read` block whose
 * every class was served — a missing class is not a zero, so it makes the
 * whole reading uncounted rather than silently low.
 */
export function progressFromOnTrack(
  onTrack: OnTrackView,
  recentlyFinished: RecentlyFinished | null
): ProgressReading {
  if (onTrack.state !== "read" || !onTrack.totals) {
    return {
      counted: false,
      reason:
        onTrack.state === "read"
          ? "the count came back without its totals"
          : "the count could not be read right now",
    };
  }
  const counts: Record<ProgressBucket, number> = {
    done: 0,
    in_progress: 0,
    blocked: 0,
    planned: 0,
    unknown: 0,
  };
  for (const cls of UNIT_CLASSES) {
    const n = onTrack.totals[cls];
    if (n === null) {
      return { counted: false, reason: "part of the count is missing" };
    }
    const bucket = CLASS_BUCKET[cls];
    if (bucket !== null) counts[bucket] += n;
  }
  return {
    counted: true,
    progress: {
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      recentlyFinished,
      excludedBookkeeping: onTrack.excludedBookkeeping,
    },
  };
}

/** A readable name for a unit without a title: its slug, minus the date. */
export function titleOf(row: Pick<CoordPlanRow, "slug" | "title">): string {
  const title = row.title?.trim();
  if (title) return title;
  const bare = row.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * The most recently finished units, from a read of SHIPPED units. Rows with no
 * recorded finish date cannot be placed in time and are left out of this list
 * (they are still counted as done above).
 */
export function recentlyFinishedFrom(
  allRows: CoordPlanRow[],
  { fetchLimit, recent = 5 }: { fetchLimit: number; recent?: number }
): RecentlyFinished {
  // The proxy's server-side exclusion of merge-shepherd bookkeeping units is
  // best-effort, so it is applied again here. `partial` is judged on the rows
  // the server actually returned, before this filter.
  const finished = allRows.filter(
    (r): r is CoordPlanRow & { first_shipped_at: string } =>
      !r.slug.startsWith(SHEPHERD_SLUG_PREFIX) && !!r.first_shipped_at
  );
  return {
    items: finished
      .sort((a, b) => b.first_shipped_at.localeCompare(a.first_shipped_at))
      .slice(0, recent)
      .map((r) => ({ title: titleOf(r), finishedAt: r.first_shipped_at })),
    partial: allRows.length >= fetchLimit,
  };
}
