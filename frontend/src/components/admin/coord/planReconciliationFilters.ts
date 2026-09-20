/**
 * `/admin/coord/plans`' two controls — and what each one's scope actually is.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 1/2.
 * Split out of the page module because a Next.js App Router page may export
 * nothing but its default and the framework's reserved names.
 */

import type { ReconciliationRowData } from "./planReconciliationStatus";

/**
 * The lifecycle words the filter offers, matched against **axis A's stored
 * status** — the same opaque string the work-unit page filters on. coord
 * accepts an off-vocabulary status deliberately, so this list is a convenience
 * over an open set, not a schema.
 *
 * **This filter is CLIENT-side, unlike the one it replaced.**
 * `GET /plan-library/reconciliation` takes `offset`, `limit` and
 * `include_coord` and nothing else, so the value narrows the rows on the
 * current page and asks the corpus nothing. The page states that scope
 * wherever the filter can empty the list; stating it is the whole difference
 * between a filter and a false absence.
 */
export const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "ready", label: "Ready" },
  { value: "shipped", label: "Shipped" },
  { value: "superseded", label: "Superseded" },
  { value: "obsolete", label: "Obsolete" },
];

/**
 * Does this row's coord status match the filter?
 *
 * A row whose axis A is UNREADABLE matches nothing but `any`. That is the
 * point: an unreadable status is UNKNOWN, and letting it fall into whichever
 * bucket is selected would answer a question the read did not answer. It is
 * also why the page names the filter when the list empties — on the degraded
 * population arm EVERY row is unreadable, so every narrowing filter empties
 * the page, and the operator must be told which control did that.
 */
export function matchesStatus(
  row: Pick<ReconciliationRowData, "axis_a">,
  filter: string
): boolean {
  if (filter === "any") return true;
  if (!row.axis_a.readable || !row.axis_a.present) return false;
  return (row.axis_a.status ?? "") === filter;
}

/**
 * Rows per page. The route's own ceiling is 100 (`Query(25, ge=1, le=100)`),
 * so nothing here may exceed it — asking for more is a 422, and asking for 500
 * the way the work-unit page does is not available on this route at all.
 */
export const PAGE_SIZES = [25, 50, 100] as const;

/** The route's own default. */
export const DEFAULT_PAGE_SIZE = 25;
