/**
 * Client-side ordering for the coord work-unit list.
 *
 * ## Why this is client-side, and what the page fetches for it
 *
 * The web proxy (`operations.py` `list_coord_plans`) forwards `status`,
 * `slug_prefix`, `exclude_slug_prefix`, `limit`, `offset`, and — since plan
 * `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`
 * — coord's `order` (`authored_desc` | `updated_desc`) and its keyset cursor
 * (`after_authored_at` + `after_slug`). coord clamps a page to 500.
 *
 * Every key here except the two `updated_*` ones makes the page WALK the whole
 * list in `order=authored_desc` (`planWalk.ts`), so these sorts run over the
 * corpus under the status filter, not over one window, and are exact. The
 * `updated_*` keys read a single `order=updated_desc` page — the explicit
 * "recently touched" view — and are the lossy ones: when that page is full,
 * the page says so and names the `updated_at` span it covers. So does a coord
 * that predates the walk, which ignores `order` and answers every sort with
 * one `updated_at DESC` page. A walk that stops early (a failed page, the page
 * cap) is labelled INCOMPLETE rather than letting the control imply a
 * corpus-wide answer.
 *
 * ## Three timestamps, three different questions
 *
 * `authored_at` is when the plan was WRITTEN (nullable, and not only
 * slug-derived — a bodyless unit's creator may supply it; plan
 * `2026-09-02-coord-work-units-carry-no-authoring-date`), read through
 * `planAuthoredAt` so that a dated slug whose coord column is NULL — a unit
 * created through the MCP upsert door, 29 of them on 2026-09-13, all the
 * NEWEST in the corpus — sorts by the date its slug carries instead of
 * sinking to the bottom as "undated" under the default sort; `created_at` is
 * when coord first INGESTED the row, which for most of the corpus is a bulk
 * backfill date; `updated_at` is the scanner's last touch (~68 s cadence). The
 * `created_*` keys were labelled "created" until that plan and defaulted the
 * page — so a four-month-old plan sorted as if written on the ingest date.
 * They are kept, relabelled "ingested", because "what did coord see first" is
 * still a real question; they just no longer answer "what is newest".
 */

import {
  planAuthoredAt,
  type CoordPlanRow,
} from "@/components/admin/coord/planStatus";

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

/**
 * The instant a time-keyed sort reads off a row. `slug_asc` never gets here.
 * The `authored_*` keys read the EFFECTIVE authoring date (slug prefix, then
 * coord's column — `planAuthoredAt`), never the bare column, so the sort
 * agrees with the identity chip on which rows are dated.
 */
function timeValueFor(
  row: CoordPlanRow,
  key: Exclude<SortKey, "slug_asc">
): string | null | undefined {
  if (key.startsWith("authored")) return planAuthoredAt(row);
  if (key.startsWith("created")) return row.created_at;
  return row.updated_at;
}

/**
 * Sort a page of work-units. Pure; never mutates the input.
 *
 * Rows whose sort timestamp is missing or unparseable sink to the bottom in
 * BOTH directions, tie-broken by slug for a stable order. That asymmetry is
 * deliberate: an absent authoring date (or `created_at`) is UNKNOWN, and
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
  const asc = key.endsWith("_asc");
  return out.sort((a, b) => {
    const ta = Date.parse(timeValueFor(a, key) ?? "");
    const tb = Date.parse(timeValueFor(b, key) ?? "");
    const aBad = Number.isNaN(ta);
    const bBad = Number.isNaN(tb);
    if (aBad && bBad) return a.slug.localeCompare(b.slug);
    if (aBad) return 1;
    if (bBad) return -1;
    if (ta === tb) return a.slug.localeCompare(b.slug);
    return asc ? ta - tb : tb - ta;
  });
}
