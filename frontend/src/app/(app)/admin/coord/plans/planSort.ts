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
 * "oldest created": if the corpus exceeds the fetch limit, the oldest-created
 * unit may simply not be in the window. The page renders a truncation notice
 * whenever the result fills the limit rather than letting the control imply a
 * corpus-wide answer.
 */

import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

export type SortKey =
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "updated_asc"
  | "slug_asc";

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "created_desc", label: "Newest created" },
  { value: "created_asc", label: "Oldest created" },
  { value: "updated_desc", label: "Recently updated" },
  { value: "updated_asc", label: "Least recently updated" },
  { value: "slug_asc", label: "Slug A→Z" },
];

/**
 * Sort a page of work-units. Pure; never mutates the input.
 *
 * Rows whose sort timestamp is missing or unparseable sink to the bottom in
 * BOTH directions, tie-broken by slug for a stable order. That asymmetry is
 * deliberate: an absent `created_at` is UNKNOWN, and "oldest created" must not
 * be answered with a row whose creation date we do not have. Treating missing
 * as epoch-zero would put exactly the least-known rows at the top.
 */
export function sortPlans(rows: CoordPlanRow[], key: SortKey): CoordPlanRow[] {
  const out = [...rows];
  if (key === "slug_asc") {
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }
  const field = key.startsWith("created") ? "created_at" : "updated_at";
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
