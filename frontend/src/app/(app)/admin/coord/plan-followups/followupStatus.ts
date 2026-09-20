/**
 * `GET /api/v1/plan-library/followups` — work a plan surfaced and nobody
 * owns, derived.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * The consumer for a route that had none.
 *
 * ## What the rows actually are
 *
 * A `spawned_followup` edge whose `to_id` is still NULL. The route's own words
 * for why it exists: *"A plan routinely surfaces work it deliberately does not
 * do, and until this route that lived ONLY as prose in the plan body —
 * unrecoverable from the data, so nothing could answer 'show me follow-ups
 * with no owning plan'."*
 *
 * ## Three properties a renderer must not lose
 *
 * 1. **`note` is the whole payload.** With no far end there is nowhere else
 *    for the finding to live, which is why the schema requires it non-blank.
 *    A surface that truncates it to a headline destroys the only copy of the
 *    finding that is queryable at all. The invariant is PINNED by
 *    `page.test.tsx` — *"renders the whole note, never a headline"* — which
 *    asserts the rendered text against a note long enough that truncation
 *    would show. It used to be "written down" as a `noteIsTruncatable()`
 *    returning a literal `false`, with a test asserting that literal: a
 *    tautology no render path called, which could not fail and therefore
 *    guarded nothing.
 * 2. **Open only, and "open" is not "undone".** A claimed follow-up becomes an
 *    ordinary two-ended edge and drops out of this list — *but it is not
 *    deleted*, and it stays on the originating artifact's edge list. So an
 *    empty page means "nothing is unowned", never "nothing was surfaced".
 * 3. **Oldest first is the useful default, and it is DECLARED.** `ordering`
 *    is on the response type *"so a consumer can assert it did not silently
 *    change"*. An old unowned follow-up is work the fleet has known about and
 *    repeatedly not picked up, which is the whole reason to read this page.
 */

// ---------------------------------------------------------------------------
// The wire shape. Mirrors `backend/app/schemas/plan_library.py`
// (`OpenFollowupResponse` / `OpenFollowup`).
// ---------------------------------------------------------------------------

export interface OpenFollowup {
  edge_id: string;
  /** The artifact that surfaced this — normally the plan that moved on. */
  from_id: string;
  from_kind: string;
  from_slug: string;
  from_title: string;
  /** The finding. Non-blank by construction, and the whole payload. */
  note: string;
  created_by?: string | null;
  created_at: string;
  age_days?: number;
}

export interface OpenFollowupResponse {
  items?: OpenFollowup[];
  count?: number;
  total?: number;
  offset?: number;
  limit?: number;
  /** Declared by the route: `"oldest_first"`. */
  ordering?: string;
}

export interface FollowupWindow {
  /** `null` when the route served no total — UNKNOWN, never `items.length`. */
  total: number | null;
  offset: number;
  limit: number | null;
  shown: number;
  /** The DECLARED ordering, so a consumer can assert it. */
  ordering: string | null;
  hasMore: boolean;
  /**
   * `true` when the route declared an ordering this build does not expect.
   * Not an error — a statement that the "oldest first" reading below the list
   * is no longer warranted by anything.
   */
  orderingUnexpected: boolean;
}

export const EXPECTED_ORDERING = "oldest_first";

export function describeFollowupWindow(
  res: OpenFollowupResponse
): FollowupWindow {
  const items = res.items ?? [];
  const total = typeof res.total === "number" ? res.total : null;
  const offset = typeof res.offset === "number" ? res.offset : 0;
  const limit = typeof res.limit === "number" ? res.limit : null;
  const ordering = typeof res.ordering === "string" ? res.ordering : null;
  return {
    total,
    offset,
    limit,
    shown: items.length,
    ordering,
    hasMore:
      total !== null
        ? offset + items.length < total
        : limit !== null && items.length >= limit,
    orderingUnexpected: ordering !== null && ordering !== EXPECTED_ORDERING,
  };
}

export interface FollowupHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail?: string;
  badges: {
    key: string;
    label: string;
    tone: "default" | "muted" | "attention";
    title?: string;
  }[];
}

const DASH = "–";

/**
 * The strip.
 *
 * Nothing here goes RED. An unowned follow-up is a backlog item, not an
 * incident: the fleet deliberately deferred it, and painting the queue red
 * would train the eye past exactly the colour R3 reserves for "someone must
 * act NOW". The age of the oldest row is the interesting figure, and it is
 * reported as a figure rather than as an alarm.
 */
export function deriveFollowupHealth(
  res: OpenFollowupResponse | null,
  loaded: boolean,
  readFailed: boolean
): FollowupHealth {
  const dashes = [
    { key: "open", label: `open ${DASH}`, tone: "muted" as const },
    { key: "oldest", label: `oldest ${DASH}`, tone: "muted" as const },
  ];
  if (!loaded || res === null) {
    return {
      level: "amber",
      headline: readFailed
        ? "Could not read the follow-up queue — unknown, not empty"
        : "Reading the follow-up queue…",
      detail: readFailed
        ? "A failed read is the absence of a measurement, never a measured zero."
        : "counts appear once the route answers",
      badges: dashes,
    };
  }
  const total = res.total;
  const items = res.items ?? [];
  const ordering = typeof res.ordering === "string" ? res.ordering : null;
  /**
   * "The first row is the oldest" is warranted by the route's DECLARED
   * ordering, so it is withdrawn whenever that declaration is not the one
   * this build expects — the same predicate `describeFollowupWindow` exposes
   * as `orderingUnexpected`, and which the page already renders as *"nothing
   * here warrants reading the first row as the oldest"*. Without this the
   * strip went on publishing `oldest 2d` while the paragraph underneath it
   * retracted the claim: one half of the page contradicting the other.
   *
   * An ABSENT ordering is not a changed one (the window agrees), so it keeps
   * the reading — the route has always declared `oldest_first` and a build
   * that omits the field has said nothing against it.
   */
  const orderingWarrantsOldest =
    ordering === null || ordering === EXPECTED_ORDERING;
  const oldest =
    orderingWarrantsOldest && (res.offset ?? 0) === 0 && items.length > 0
      ? (items[0]?.age_days ?? null)
      : null;
  return {
    // Finding 13's shape: a failed refresh is not green. The detail already
    // said the counts were stale while the colour said everything was fine,
    // and the colour is what gets read.
    level: readFailed ? "amber" : "green",
    headline:
      typeof total === "number"
        ? total === 0
          ? "No follow-up is waiting for an owner"
          : `${total} follow-ups nobody owns`
        : "Follow-ups read; the route served no total",
    detail: readFailed
      ? "Last refresh failed — these counts are stale."
      : typeof total === "number" && total === 0
        ? "Claimed follow-ups drop out of this list but are not deleted — an empty queue means nothing is UNOWNED, not that nothing was surfaced."
        : undefined,
    badges: [
      {
        key: "open",
        label: `open ${typeof total === "number" ? total : DASH}`,
        tone: "muted",
        title:
          "Unpaged total, so a bounded page can never be mistaken for the whole queue.",
      },
      {
        key: "oldest",
        label: `oldest ${oldest === null ? DASH : `${Math.round(oldest)}d`}`,
        tone: "default",
        // `oldest` is null for FOUR distinct causes, and each gets its own
        // sentence. Two arms once covered all four, so on page 1 of a route
        // that served no `age_days` the dash explained itself with "the
        // oldest row is only on the first page" — a confident reason for a
        // state that is not the one it describes.
        title:
          oldest !== null
            ? "Days since the follow-up was recorded. An old unowned follow-up is work the fleet has known about and repeatedly not picked up."
            : !orderingWarrantsOldest
              ? `The route declared its ordering as "${ordering}", not ${EXPECTED_ORDERING}, so nothing warrants reading the first row as the oldest.`
              : (res.offset ?? 0) !== 0
                ? "The oldest row is only on the first page, so it is not measured from here."
                : items.length === 0
                  ? "This page returned no follow-up, so there is no row to read an age from — unknown, not zero."
                  : "The route served no age for the first row, so how old the oldest follow-up is is UNKNOWN — it is not 'new'.",
      },
    ],
  };
}
