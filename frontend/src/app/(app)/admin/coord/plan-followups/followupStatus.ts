/**
 * `GET /api/v1/plan-library/followups` — work a plan surfaced, by state.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c
 * made this the consumer for a route that had none. Plan
 * `2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down`
 * Phase 3 gave the follow-up a closure state and file anchors, so the page
 * now reads it by state.
 *
 * ## What the rows actually are
 *
 * A `spawned_followup` edge no artifact owns. The route's own words for why it
 * exists: *"A plan routinely surfaces work it deliberately does not do, and
 * until this route that lived ONLY as prose in the plan body — unrecoverable
 * from the data, so nothing could answer 'show me follow-ups with no owning
 * plan'."*
 *
 * Each row is in one state: `open` (nobody owns it and nothing closed it),
 * `fixing` (a PR that fixes it is open), or resolved — `fixed` (coord saw that
 * PR land), `already_fixed` (an earlier commit fixed it) or `dismissed`
 * (closed without a fix, with a reason).
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
 * 2. **Leaving the open view is not "undone".** A claimed follow-up becomes
 *    an ordinary two-ended edge and a resolved one moves to its state view —
 *    *neither is deleted*. So an empty open view means "nothing is unowned
 *    and unresolved", never "nothing was surfaced".
 * 3. **Oldest first is the useful default, and it is DECLARED.** `ordering`
 *    is on the response type *"so a consumer can assert it did not silently
 *    change"*. An old unowned follow-up is work the fleet has known about and
 *    repeatedly not picked up, which is the whole reason to read this page.
 */

import {
  describeBoundedWindow,
  type BoundedReadMeta,
} from "@/components/admin/coord/cursorPager";

// ---------------------------------------------------------------------------
// The wire shape. Mirrors `backend/app/schemas/plan_library_followups.py`
// (`OpenFollowupResponse` / `OpenFollowup` / `FollowupFacts`).
// ---------------------------------------------------------------------------

/** What a follow-up IS right now (`FollowupState`). */
export type FollowupState =
  | "open"
  | "fixing"
  | "fixed"
  | "already_fixed"
  | "dismissed"
  | "claimed";

/** One file a follow-up is about. `repo` + `path` are the match key; the
 *  line hints drift and are never part of a match. */
export interface FollowupAnchor {
  repo: string;
  path: string;
  line_start?: number | null;
  line_end?: number | null;
  symbol?: string | null;
}

/** One transition, as `resolution_history` records it. */
export interface FollowupHistoryEntry {
  from: string;
  to: string;
  at: string;
  by?: string | null;
  pr?: string | null;
  commit?: string | null;
  note?: string | null;
}

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
  /** Absent only from a backend that predates closure states — then the row
   *  is `open` by the only definition that backend had. */
  state?: FollowupState;
  anchors?: FollowupAnchor[];
  /** `null` is UNCLASSIFIED — nobody has sized it, not "small". */
  size_class?: "trivial" | "small" | "plan_sized" | null;
  size_class_source?: "declared" | "sweep" | null;
  unanchored_reason?: string | null;
  resolution?: "fixing" | "fixed" | "already_fixed" | "dismissed" | null;
  /** `owner/name#n`. */
  resolution_pr?: string | null;
  resolution_commit?: string | null;
  resolution_note?: string | null;
  resolved_by?: string | null;
  /** When the current state was entered — a `fixing` row's age reads here. */
  resolved_at?: string | null;
  resolution_history?: FollowupHistoryEntry[];
}

/**
 * A keyset walk: the shared bounded-read keys describe `items`, `total`
 * counts from THIS page's start, and `next_cursor` is passed back as
 * `cursor`. There is no `offset`.
 */
export interface OpenFollowupResponse extends Partial<
  Omit<BoundedReadMeta, "total">
> {
  items?: OpenFollowup[];
  total?: number | null;
  /** Declared by the route: `"oldest_first"`. */
  ordering?: string;
  /** The filters the page was read under, echoed by the route. */
  filters?: { state?: string | null } | null;
}

// ---------------------------------------------------------------------------
// The views the page offers. Each is one `?state=` value of the route.
// ---------------------------------------------------------------------------

export type FollowupView = "open" | "fixing" | "resolved";

export const FOLLOWUP_VIEWS: readonly FollowupView[] = [
  "open",
  "fixing",
  "resolved",
];

export const FOLLOWUP_VIEW_LABELS: Record<FollowupView, string> = {
  open: "Open",
  fixing: "Fixing",
  resolved: "Resolved",
};

/** `repo:path`, with `:line` (or `:start-end`) when the anchor names lines. */
export function formatAnchor(anchor: FollowupAnchor): string {
  const base = `${anchor.repo}:${anchor.path}`;
  const start = anchor.line_start;
  if (typeof start !== "number") return base;
  const end = anchor.line_end;
  return typeof end === "number" && end > start
    ? `${base}:${start}-${end}`
    : `${base}:${start}`;
}

/**
 * Days since a row entered its current state (`resolved_at`), or `null` when
 * the row carries no such time — UNKNOWN, never "0 days".
 */
export function daysInState(
  followup: OpenFollowup,
  now: Date = new Date()
): number | null {
  if (!followup.resolved_at) return null;
  const entered = Date.parse(followup.resolved_at);
  if (Number.isNaN(entered)) return null;
  return Math.max(0, (now.getTime() - entered) / 86_400_000);
}

export interface FollowupWindow {
  /** The whole view (rows already walked + the route's `total` from this
   *  page's start); `null` when the route served no count — UNKNOWN, never
   *  `items.length`. */
  total: number | null;
  /** Rows served before this page, from the cursor walk. */
  start: number;
  limit: number | null;
  shown: number;
  /** The DECLARED ordering, so a consumer can assert it. */
  ordering: string | null;
  hasMore: boolean;
  nextCursor: string | null;
  /**
   * `true` when the route declared an ordering this build does not expect.
   * Not an error — a statement that the "oldest first" reading below the list
   * is no longer warranted by anything.
   */
  orderingUnexpected: boolean;
}

export const EXPECTED_ORDERING = "oldest_first";

export function describeFollowupWindow(
  res: OpenFollowupResponse,
  start = 0
): FollowupWindow {
  const window = describeBoundedWindow(
    { ...res, total: typeof res.total === "number" ? res.total : null },
    start
  );
  const limit = typeof res.limit === "number" ? res.limit : null;
  const ordering = typeof res.ordering === "string" ? res.ordering : null;
  return {
    total: window.populationTotal,
    start,
    limit,
    shown: window.shown,
    ordering,
    hasMore: window.hasMore,
    nextCursor: window.nextCursor,
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

/** Each view's headline, for a known total. */
function headlineFor(view: FollowupView, total: number): string {
  if (view === "fixing") {
    return total === 0
      ? "No follow-up is held by an open fix PR"
      : `${total} follow-ups held by an open fix PR`;
  }
  if (view === "resolved") {
    return total === 0
      ? "No follow-up has been resolved"
      : `${total} follow-ups resolved`;
  }
  return total === 0
    ? "No follow-up is waiting for an owner"
    : `${total} follow-ups nobody owns`;
}

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
  readFailed: boolean,
  start = 0,
  view: FollowupView = "open"
): FollowupHealth {
  const dashes = [
    { key: "open", label: `${view} ${DASH}`, tone: "muted" as const },
    { key: "oldest", label: `oldest ${DASH}`, tone: "muted" as const },
  ];
  if (!loaded || res === null) {
    return {
      level: "amber",
      headline: readFailed
        ? "Could not read the follow-ups — unknown, not empty"
        : "Reading the follow-ups…",
      detail: readFailed
        ? "A failed read is the absence of a measurement, never a measured zero."
        : "counts appear once the route answers",
      badges: dashes,
    };
  }
  // The route's `total` counts from this page's start; the whole view is
  // the rows already walked plus it.
  const total = typeof res.total === "number" ? start + res.total : null;
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
    orderingWarrantsOldest && start === 0 && items.length > 0
      ? (items[0]?.age_days ?? null)
      : null;
  return {
    // Finding 13's shape: a failed refresh is not green. The detail already
    // said the counts were stale while the colour said everything was fine,
    // and the colour is what gets read.
    level: readFailed ? "amber" : "green",
    headline:
      typeof total === "number"
        ? headlineFor(view, total)
        : "Follow-ups read; the route served no total",
    detail: readFailed
      ? "Last refresh failed — these counts are stale."
      : view === "open" && typeof total === "number" && total === 0
        ? "Claimed and resolved follow-ups drop out of the open view but are not deleted — an empty open view means nothing is UNOWNED and unresolved, not that nothing was surfaced."
        : undefined,
    badges: [
      {
        key: "open",
        label: `${view} ${typeof total === "number" ? total : DASH}`,
        tone: "muted",
        title:
          "Unpaged total, so a bounded page can never be mistaken for the whole view.",
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
              : start !== 0
                ? "The oldest row is only on the first page, so it is not measured from here."
                : items.length === 0
                  ? "This page returned no follow-up, so there is no row to read an age from — unknown, not zero."
                  : "The route served no age for the first row, so how old the oldest follow-up is is UNKNOWN — it is not 'new'.",
      },
    ],
  };
}
