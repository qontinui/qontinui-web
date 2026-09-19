/**
 * Walk coord's work-unit list to the end, in authoring order.
 *
 * Plan `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`
 * Phases 1–2. The page used to make ONE `limit=500` read of a list coord
 * orders `updated_at DESC` — a field background workers rewrite — so the
 * visible set was whatever had been touched most recently, and a plan quiet for
 * longer than the window simply was not on the page. Measured: a 2 min 38 s
 * window on 2026-09-12, 3.8 days on 2026-09-19, and the target plan outside
 * both.
 *
 * The fix is to stop reading a slice. With `order=authored_desc` coord answers
 * in `authored_at DESC NULLS LAST, slug` order with a keyset `next_cursor`,
 * and this module follows it until coord says there is no next page. The
 * client sort then runs over the whole corpus (under the status filter), so it
 * is exact rather than a sort of one window.
 *
 * ## Three outcomes, and why none of them may impersonate another
 *
 * - `complete` — coord echoed `order: "authored_desc"` and the walk reached a
 *   null `next_cursor`. Every unit matching the filter is on the page.
 * - `partial` — the walk STARTED but stopped early: a page read failed, the
 *   page cap was hit, or coord handed back a cursor that did not advance. The
 *   rows fetched are kept (they are true), but the page must say the list is
 *   INCOMPLETE and which authoring range it covers — a partial walk rendered as
 *   the whole corpus is `silent-empty-is-unknown` with a longer list.
 * - `single_page` — one read and no walk: either the operator chose
 *   "Recently updated" (`order=updated_desc`, a deliberately single-page view),
 *   or coord predates the walk. An older coord ignores the new params and
 *   returns its `updated_at`-ordered page with NO `order` echo, and that echo's
 *   absence is the only reliable tell — following a cursor it never sent is
 *   impossible, and looping on `offset` would re-create the churn-shifted
 *   window this plan exists to remove. When that page is full it is
 *   `truncated`, and the page names the `updated_at` span it covers.
 */

import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { SortKey } from "./planSort";

/** coord's page clamp (`work_unit_registry.rs` `list_work_units`). */
export const WALK_PAGE_LIMIT = 500;

/**
 * A hard stop on the walk, so a coord that kept handing out cursors could not
 * spin the page forever. 20 × 500 = 10k units — ~5× the non-shepherd corpus
 * measured 2026-09-19 (~1.8k). Hitting it is reported as `partial`, never
 * rendered as complete.
 */
export const WALK_MAX_PAGES = 20;

/** The two server orders coord's list accepts. */
export type ServerOrder = "authored_desc" | "updated_desc";

/**
 * The server order a client sort needs.
 *
 * Only the two `updated_*` sorts read the mutation-time order, and they keep
 * it as an explicit single-page "recently touched" view (plan option 3).
 * Everything else — authored, ingested, slug — needs the WHOLE corpus to be
 * exact, so it walks.
 */
export function serverOrderFor(sort: SortKey): ServerOrder {
  return sort.startsWith("updated") ? "updated_desc" : "authored_desc";
}

export interface WalkCursor {
  /** RFC3339, or null while walking the NULL-authored tail. */
  after_authored_at: string | null;
  after_slug: string;
}

export interface PlansListResponse {
  // coord `/coord/work-units` returns rows under `work_units`. `plans` is
  // kept for backwards-tolerance during the cutover (harmless if absent).
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
  limit?: number;
  offset?: number;
  count?: number;
  /** Echoed by a coord that understood `order`; absent on an older one. */
  order?: string;
  /** Non-null only when the page was full and another may follow. */
  next_cursor?: WalkCursor | null;
}

export type PartialReason = "error" | "page_cap" | "stalled";

export type WalkOutcome =
  | { kind: "complete"; rows: CoordPlanRow[]; pages: number }
  | {
      kind: "partial";
      rows: CoordPlanRow[];
      pages: number;
      reason: PartialReason;
      /** The failing read's message, for `reason: "error"`. */
      error?: string;
    }
  | {
      kind: "single_page";
      rows: CoordPlanRow[];
      order: ServerOrder;
      /** The page came back full, so the corpus is larger than what is shown. */
      truncated: boolean;
      /** coord ignored `order=authored_desc` — it predates the walk. */
      legacyCoord: boolean;
    };

export type GetJson = <T>(url: string) => Promise<T>;

function rowsOf(body: PlansListResponse | null | undefined): CoordPlanRow[] {
  return body?.work_units ?? body?.plans ?? [];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Read the list under `baseParams` (status + shepherd exclusion) in `order`.
 *
 * `stillCurrent` is consulted before every follow-up page: when the caller's
 * question or request has been superseded, the walk stops issuing reads and
 * resolves `null`, which the caller drops. A FIRST-page failure throws — it
 * is the same "could not read the list" the page has always surfaced — while a
 * failure on any later page is kept as `partial`.
 */
export async function walkWorkUnits(
  get: GetJson,
  url: string,
  baseParams: URLSearchParams,
  order: ServerOrder,
  stillCurrent: () => boolean
): Promise<WalkOutcome | null> {
  const pageUrl = (cursor: WalkCursor | null) => {
    const qs = new URLSearchParams(baseParams);
    qs.set("limit", String(WALK_PAGE_LIMIT));
    qs.set("order", order);
    if (cursor) {
      // `after_authored_at: null` means "inside the NULL-authored tail":
      // coord's contract is to send `after_slug` alone there.
      if (cursor.after_authored_at) {
        qs.set("after_authored_at", cursor.after_authored_at);
      }
      qs.set("after_slug", cursor.after_slug);
    }
    return `${url}?${qs.toString()}`;
  };

  const first = await get<PlansListResponse>(pageUrl(null));
  const firstRows = rowsOf(first);

  if (order === "updated_desc" || first?.order !== "authored_desc") {
    return {
      kind: "single_page",
      rows: firstRows,
      order,
      truncated: firstRows.length >= WALK_PAGE_LIMIT,
      legacyCoord: order === "authored_desc",
    };
  }

  // Keyed by slug: a unit re-authored between two reads could in principle
  // appear on both sides of a cursor, and `<RecordList>` keys rows by slug.
  const seen = new Map<string, CoordPlanRow>();
  const add = (rows: CoordPlanRow[]) => {
    for (const r of rows) if (!seen.has(r.slug)) seen.set(r.slug, r);
  };
  add(firstRows);
  let pages = 1;
  let cursor = first.next_cursor ?? null;

  while (cursor) {
    if (pages >= WALK_MAX_PAGES) {
      return {
        kind: "partial",
        rows: [...seen.values()],
        pages,
        reason: "page_cap",
      };
    }
    if (!stillCurrent()) return null;
    let body: PlansListResponse;
    try {
      body = await get<PlansListResponse>(pageUrl(cursor));
    } catch (e) {
      if (!stillCurrent()) return null;
      return {
        kind: "partial",
        rows: [...seen.values()],
        pages,
        reason: "error",
        error: message(e),
      };
    }
    pages += 1;
    add(rowsOf(body));
    const next = body?.next_cursor ?? null;
    if (
      next &&
      next.after_slug === cursor.after_slug &&
      (next.after_authored_at ?? null) === (cursor.after_authored_at ?? null)
    ) {
      // A cursor that does not advance would re-read the same page until the
      // cap; say what happened instead.
      return {
        kind: "partial",
        rows: [...seen.values()],
        pages,
        reason: "stalled",
      };
    }
    cursor = next;
  }
  return { kind: "complete", rows: [...seen.values()], pages };
}

/** `[oldest, newest]` of a timestamp column over `rows`; nulls ignored. */
export function timeSpan(
  rows: CoordPlanRow[],
  pick: (row: CoordPlanRow) => string | null | undefined
): { oldest: string; newest: string } | null {
  let oldest: { t: number; s: string } | null = null;
  let newest: { t: number; s: string } | null = null;
  for (const r of rows) {
    const s = pick(r);
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isNaN(t)) continue;
    if (!oldest || t < oldest.t) oldest = { t, s };
    if (!newest || t > newest.t) newest = { t, s };
  }
  return oldest && newest ? { oldest: oldest.s, newest: newest.s } : null;
}

/** `2026-09-19 18:30Z` — minute precision, UTC, no locale drift. */
export function formatInstant(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** The fields of coord's `GET /coord/work-units/overview` the page reads. */
export interface WorkUnitOverview {
  row_count?: number;
  corpus_complete?: boolean;
  facets?: {
    by_status?: Record<string, number>;
    by_status_truncated?: boolean;
  };
}

/**
 * coord's own total for the question the page asked — or `null` when the
 * overview cannot answer it (unread, malformed, or a truncated `by_status`
 * that may have dropped this status).
 *
 * The overview takes NO filters by coord's design, so it always counts the
 * `shepherd-*` rows this page excludes; `includesExcluded` carries that
 * difference to the copy rather than letting the two totals be compared as
 * like with like.
 */
export function overviewTotalFor(
  overview: WorkUnitOverview | null,
  status: string
): { total: number; includesExcluded: true } | null {
  if (!overview) return null;
  if (status === "any") {
    return typeof overview.row_count === "number"
      ? { total: overview.row_count, includesExcluded: true }
      : null;
  }
  const byStatus = overview.facets?.by_status;
  if (!byStatus || typeof byStatus !== "object") return null;
  const n = byStatus[status];
  if (typeof n === "number") return { total: n, includesExcluded: true };
  // An absent key is a stated zero ONLY when the facet was not truncated —
  // otherwise the status may be one of the long-tail spellings it dropped.
  return overview.facets?.by_status_truncated === false
    ? { total: 0, includesExcluded: true }
    : null;
}
