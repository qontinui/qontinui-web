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
 *   null `next_cursor`. Every unit matching the filter is on the page, with ONE
 *   bound worth stating plainly, because a `complete` that overstated itself
 *   would be the same class of defect as the slice it replaced.
 *
 *   **A keyset walk is only exact over rows whose sort key does not move while
 *   it runs.** The key here is `authored_at`, and it is not frozen: coord's
 *   half of this same plan HEALS a NULL `authored_at` to the slug-derived date
 *   on each row's next upsert, and the runner's plan scanner re-upserts the
 *   plans it scans about once a minute. So a row sitting in the NULL-authored
 *   tail can acquire a date in a region the walk has ALREADY passed, between
 *   two of its pages, and be on neither — while coord still hands back a null
 *   `next_cursor` and this module still, correctly by its own lights, reports
 *   `complete`. The opposite direction is harmless: a row that moves INTO a
 *   region still ahead is read twice, and `seen` keys by slug.
 *
 *   The bound cannot be closed client-side (a snapshot read would have to be
 *   coord's), it is narrow (one row, one healing upsert, one walk), and it is
 *   self-correcting on the next read — so what this module owes is to say it
 *   rather than to hide it. `page.tsx` says it in the caveat copy too: the page
 *   may not assert more than a walk can know.
 * - `partial` — the walk STARTED but stopped early: a page read failed, the
 *   page cap was hit, or coord handed back a cursor it had already sent. The
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
import {
  foldBodySignalBlocks,
  type FoldedBodySignal,
  type PlanBodySignalBlock,
} from "@/components/admin/coord/planBodySignal";
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
  /**
   * The size of the WHOLE matching population, when coord serves one (it
   * does not today: the envelope is `{work_units, limit, offset}` plus
   * `count`). Read on the `single_page` arm only, where it is the one page's
   * own statement and the truncation notice's denominator. A walk does not
   * need it and does not fold it: a walk's denominator is the rows it read,
   * cross-checked against `/plans/overview` — see {@link overviewTotalFor}.
   * Never substituted from `count`, which is the size of the PAGE.
   */
  total?: number;
  /**
   * Why a `has_body: false` on THIS PAGE is (or is not) evidence — computed
   * per request by the proxy (plan
   * `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`).
   * Absent when the page had no rows to annotate, and on a backend that
   * predates the signals. A walk collects one per page and folds them; see
   * {@link WalkOutcome}'s `bodySignal`.
   */
  body_signal?: PlanBodySignalBlock;
}

/**
 * `stalled` covers every cursor that does not make progress, not only one that
 * repeats itself immediately: see `cursorKey`.
 */
export type PartialReason = "error" | "page_cap" | "stalled";

/**
 * What every outcome carries regardless of how the walk ended.
 *
 * `bodySignal` is the fold of every page's `body_signal` block
 * (`foldBodySignalBlocks`), so the body-signal feature survives a walk without
 * having to be re-read per page by its consumers: the proxy annotates each
 * page's ROWS and explains that page, and this is the one explanation for the
 * one answer on screen. `null` = no page carried a block (an empty list, or a
 * backend predating the signals) — not a block full of falses.
 *
 * A `partial` walk's fold covers the pages that were READ. That is the same
 * qualification the rows carry and it is made in the same place: the page
 * states the list is incomplete, and this block is incomplete in exactly the
 * same way.
 *
 * It is a `FoldedBodySignal` rather than a page's `PlanBodySignalBlock`
 * because the fold knows one thing no page can: whether a miss covers every
 * page of this read or only some of them (`miss_scope`). The copy on screen is
 * worded off that, so a multi-page walk stops stating of the whole read what
 * was only true of one page.
 */
interface WalkCommon {
  rows: CoordPlanRow[];
  bodySignal: FoldedBodySignal | null;
}

export type WalkOutcome =
  | ({ kind: "complete"; pages: number } & WalkCommon)
  | ({
      kind: "partial";
      pages: number;
      reason: PartialReason;
      /** The failing read's message, for `reason: "error"`. */
      error?: string;
    } & WalkCommon)
  | ({
      kind: "single_page";
      order: ServerOrder;
      /** The page came back full, so the corpus is larger than what is shown. */
      truncated: boolean;
      /** coord ignored `order=authored_desc` — it predates the walk. */
      legacyCoord: boolean;
      /**
       * The page's own `total`, or `null` when it served none — UNKNOWN,
       * never `count`. See `PlansListResponse.total`.
       */
      total: number | null;
    } & WalkCommon);

export type GetJson = <T>(url: string) => Promise<T>;

function rowsOf(body: PlansListResponse | null | undefined): CoordPlanRow[] {
  return body?.work_units ?? body?.plans ?? [];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A cursor's identity, so the walk can ask "have I already followed this one?"
 * against EVERY cursor it has seen — the `visited` set — rather than against
 * the immediately previous one.
 *
 * One predicate then settles both shapes of non-progress, and labels each
 * correctly: a cursor already visited cannot yield a page this walk has not
 * read, whether the repeat is `A → A` or a longer cycle. A one-step comparison
 * catches only the first; under a coord alternating `A → B → A → B` every
 * single step "advances", so the walk would burn all {@link WALK_MAX_PAGES}
 * pages and report `reason: "page_cap"` — "the corpus is bigger than the cap" —
 * about a coord that was not paginating at all. The page tells the operator to
 * do different things about `stalled` and `page_cap`, so the label has to be
 * right.
 *
 * `after_authored_at: null` is a distinct, meaningful value (the NULL-authored
 * tail), so it is encoded rather than dropped; `\u0000` cannot appear in an
 * RFC3339 instant, so no slug can forge another cursor's key.
 */
function cursorKey(cursor: WalkCursor): string {
  return `${cursor.after_authored_at ?? ""}\u0000${cursor.after_slug}`;
}

/**
 * Read the list under `baseParams` (status, and the shepherd exclusion when
 * the operator chose it) in `order`. Every page is built from `baseParams`, so
 * a server-side filter set by the caller rides on every read of the walk.
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
  // One block per page read, folded at every exit — see `WalkCommon`.
  const signals: Array<PlanBodySignalBlock | undefined> = [first?.body_signal];

  if (order === "updated_desc" || first?.order !== "authored_desc") {
    return {
      kind: "single_page",
      rows: firstRows,
      bodySignal: foldBodySignalBlocks(signals),
      order,
      truncated: firstRows.length >= WALK_PAGE_LIMIT,
      legacyCoord: order === "authored_desc",
      total: typeof first?.total === "number" ? first.total : null,
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
  // Every cursor this walk has issued a read for — see `cursorKey`.
  const visited = new Set<string>();

  while (cursor) {
    if (pages >= WALK_MAX_PAGES) {
      return {
        kind: "partial",
        rows: [...seen.values()],
        bodySignal: foldBodySignalBlocks(signals),
        pages,
        reason: "page_cap",
      };
    }
    if (!stillCurrent()) return null;
    visited.add(cursorKey(cursor));
    let body: PlansListResponse;
    try {
      body = await get<PlansListResponse>(pageUrl(cursor));
    } catch (e) {
      if (!stillCurrent()) return null;
      return {
        kind: "partial",
        rows: [...seen.values()],
        bodySignal: foldBodySignalBlocks(signals),
        pages,
        reason: "error",
        error: message(e),
      };
    }
    pages += 1;
    add(rowsOf(body));
    signals.push(body?.body_signal);
    const next = body?.next_cursor ?? null;
    if (next && visited.has(cursorKey(next))) {
      // A cursor the walk has already followed yields a page it has already
      // read, so continuing would burn the cap re-reading it. Say what
      // happened instead — including when the repeat is a longer cycle than
      // `A → A`, which is what `cursorKey`/`visited` are here for.
      return {
        kind: "partial",
        rows: [...seen.values()],
        bodySignal: foldBodySignalBlocks(signals),
        pages,
        reason: "stalled",
      };
    }
    cursor = next;
  }
  return {
    kind: "complete",
    rows: [...seen.values()],
    bodySignal: foldBodySignalBlocks(signals),
    pages,
  };
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

/**
 * The fields of coord's `GET /coord/work-units/overview` the page reads.
 *
 * It deliberately does NOT declare `corpus_complete`, which the response also
 * carries, because declaring a field no consumer reads invites the belief that
 * completeness is being checked when it is not. Nothing is lost by leaving it
 * out: coord sets `corpus_complete: !by_status_truncated`
 * (`work_unit_registry.rs` `work_unit_overview_body`) — exactly the flag
 * {@link overviewTotalFor} already gates the per-status total on — while
 * `row_count`, the total the `status=any` arm reads, is folded from the
 * complete tally BEFORE any truncation and is whole-corpus in both arms. So
 * reading `corpus_complete` here would either duplicate the truncation check
 * or discard a `row_count` that is not truncated at all.
 */
export interface WorkUnitOverview {
  row_count?: number;
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
 * `shepherd-*` rows. Whether the page read them too is the caller's shepherd
 * control (`SHEPHERD_FILTERS`, `plansHealth.tsx`), so the caller says so:
 * `includesExcluded` is true exactly when the page asked coord to EXCLUDE
 * them, and it carries that difference to the copy rather than letting two
 * totals over different sets be compared as like with like.
 */
export function overviewTotalFor(
  overview: WorkUnitOverview | null,
  status: string,
  shepherdExcluded: boolean
): { total: number; includesExcluded: boolean } | null {
  if (!overview) return null;
  const includesExcluded = shepherdExcluded;
  if (status === "any") {
    return typeof overview.row_count === "number"
      ? { total: overview.row_count, includesExcluded }
      : null;
  }
  const byStatus = overview.facets?.by_status;
  if (!byStatus || typeof byStatus !== "object") return null;
  const n = byStatus[status];
  if (typeof n === "number") return { total: n, includesExcluded };
  // An absent key is a stated zero ONLY when the facet was not truncated —
  // otherwise the status may be one of the long-tail spellings it dropped.
  return overview.facets?.by_status_truncated === false
    ? { total: 0, includesExcluded }
    : null;
}
