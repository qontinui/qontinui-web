/**
 * How the project's work is progressing, from coord's work units (the plans
 * behind `/api/v1/operations/plans`), in words a business reader uses.
 *
 * Work-unit status is a closed vocabulary (served policy `plan-discipline`):
 * `draft`, `vetted`, `ready`, `in_progress`, `blocked`, `shipped`,
 * `superseded`, `obsolete`. Superseded and obsolete units are work that will
 * not be done, so they count toward nothing. Anything else is reported as
 * "other" rather than silently dropped.
 */

import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

export type ProgressBucket = "done" | "in_progress" | "blocked" | "planned";

export const PROGRESS_BUCKETS: readonly {
  key: ProgressBucket;
  label: string;
}[] = [
  { key: "done", label: "Done" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "planned", label: "Planned" },
];

const STATUS_BUCKET: Record<string, ProgressBucket | "dropped"> = {
  shipped: "done",
  in_progress: "in_progress",
  ready: "in_progress",
  blocked: "blocked",
  draft: "planned",
  vetted: "planned",
  superseded: "dropped",
  obsolete: "dropped",
};

export interface FinishedItem {
  title: string;
  finishedAt: string;
}

export interface Progress {
  counts: Record<ProgressBucket, number>;
  /** Units counted in a bucket (dropped and unrecognised units excluded). */
  total: number;
  /** Units whose status this page does not recognise. */
  other: number;
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
  rows: CoordPlanRow[],
  { fetchLimit, recent = 5 }: { fetchLimit: number; recent?: number }
): Progress {
  const counts: Record<ProgressBucket, number> = {
    done: 0,
    in_progress: 0,
    blocked: 0,
    planned: 0,
  };
  let other = 0;
  for (const row of rows) {
    const bucket = STATUS_BUCKET[(row.status ?? "").toLowerCase()];
    if (bucket === undefined) other += 1;
    else if (bucket !== "dropped") counts[bucket] += 1;
  }

  const recentlyFinished = rows
    .filter(
      (r): r is CoordPlanRow & { first_shipped_at: string } =>
        (r.status ?? "").toLowerCase() === "shipped" && !!r.first_shipped_at
    )
    .sort((a, b) => b.first_shipped_at.localeCompare(a.first_shipped_at))
    .slice(0, recent)
    .map((r) => ({ title: titleOf(r), finishedAt: r.first_shipped_at }));

  return {
    counts,
    total: counts.done + counts.in_progress + counts.blocked + counts.planned,
    other,
    truncated: rows.length >= fetchLimit,
    recentlyFinished,
  };
}
