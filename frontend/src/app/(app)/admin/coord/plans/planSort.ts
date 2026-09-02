/**
 * Client-side ordering for the coord work-unit list.
 *
 * ## Why this is client-side, and what that costs
 *
 * The web proxy (`operations.py` `list_coord_plans`) forwards only `status`
 * and `limit` — there is no sort parameter to pass through — and coord's own
 * list is fixed at `ORDER BY updated_at DESC LIMIT $3 OFFSET $4`
 * (`work_unit_registry.rs` `list_work_units`), default 100, clamped to 500.
 *
 * So the page sorts the window it fetched, not the corpus. That is fine for
 * "recently updated" (coord already ordered by it) but genuinely lossy for
 * "oldest authored" or "oldest ingested": if the corpus exceeds the fetch
 * limit, the oldest unit may simply not be in the window. The page renders a
 * truncation notice whenever the result fills the limit rather than letting
 * the control imply a corpus-wide answer.
 *
 * ## Three timestamps, three different questions
 *
 * `authored_at` is when the plan was WRITTEN (slug-derived, nullable — plan
 * `2026-09-02-coord-work-units-carry-no-authoring-date`); `created_at` is
 * when coord first INGESTED the row, which for most of the corpus is a bulk
 * backfill date; `updated_at` is the scanner's last touch (~68 s cadence). The
 * `created_*` keys were labelled "created" until that plan and defaulted the
 * page — so a four-month-old plan sorted as if written on the ingest date.
 * They are kept, relabelled "ingested", because "what did coord see first" is
 * still a real question; they just no longer answer "what is newest".
 */

import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

export type SortKey =
  | "authored_desc"
  | "authored_asc"
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "updated_asc"
  | "slug_asc";

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "authored_desc", label: "Newest authored" },
  { value: "authored_asc", label: "Oldest authored" },
  { value: "created_desc", label: "Newest ingested" },
  { value: "created_asc", label: "Oldest ingested" },
  { value: "updated_desc", label: "Recently updated" },
  { value: "updated_asc", label: "Least recently updated" },
  { value: "slug_asc", label: "Slug A→Z" },
];

type TimeField = "authored_at" | "created_at" | "updated_at";

/** The row column a time-keyed sort reads. `slug_asc` never gets here. */
function timeFieldFor(key: Exclude<SortKey, "slug_asc">): TimeField {
  if (key.startsWith("authored")) return "authored_at";
  if (key.startsWith("created")) return "created_at";
  return "updated_at";
}

/**
 * Sort a page of work-units. Pure; never mutates the input.
 *
 * Rows whose sort timestamp is missing or unparseable sink to the bottom in
 * BOTH directions, tie-broken by slug for a stable order. That asymmetry is
 * deliberate: an absent `authored_at` (or `created_at`) is UNKNOWN, and
 * "oldest authored" must not be answered with a row whose authoring date we do
 * not have. Treating missing as epoch-zero would put exactly the least-known
 * rows at the top — and with a coord that predates the `authored_at` column
 * that is EVERY row, so the default sort would be an ordering of nothing.
 */
export function sortPlans(rows: CoordPlanRow[], key: SortKey): CoordPlanRow[] {
  const out = [...rows];
  if (key === "slug_asc") {
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }
  const field = timeFieldFor(key);
  const asc = key.endsWith("_asc");
  return out.sort((a, b) => {
    const ta = Date.parse(a[field] ?? "");
    const tb = Date.parse(b[field] ?? "");
    const aBad = Number.isNaN(ta);
    const bBad = Number.isNaN(tb);
    if (aBad && bBad) return a.slug.localeCompare(b.slug);
    if (aBad) return 1;
    if (bBad) return -1;
    if (ta === tb) return a.slug.localeCompare(b.slug);
    return asc ? ta - tb : tb - ta;
  });
}
