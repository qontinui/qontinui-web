"use client";

/**
 * /admin/coord/notifications — the append-only `coord.notifications` feed.
 *
 * Plan `2026-08-05-coord-notifications-type-and-tab.md` Change 4. This is the
 * EVENT surface, the deliberate counterpart to `/admin/coord/alerts` (the
 * CONDITION surface):
 *
 *   Alerts        — "what is wrong right now?"   fire → persist → resolve
 *   Notifications — "what happened while I was away?"  append-only, per-actor
 *                                                       read state
 *
 * Conventions follow the sibling plan's SHARED UI CONVENTIONS section: one row
 * per event, one plain-language line (coord pre-renders `summary`), detail
 * behind the click, no UUID in the default view, existing `@/components/ui/*`
 * primitives, `httpClient`, and `POLL_INTERVAL_MS = 10_000` for this
 * foreground surface (the nav badge polls at 60s — it is a background hint).
 *
 * Two counts, and neither is `rows.length`: `total` and `unread_count` are
 * server-computed scalars. The endpoint is genuinely paged, so a count taken
 * from the returned array would report the PAGE SIZE — the exact misread this
 * plan exists to stop.
 *
 * Mark-read has two disjoint, explicit arms — `{notification_ids: [...]}` and
 * `{all: true}` — and the scope follows the VIEW. `{all: true}` marks every
 * unread row for this principal, and there is no mark-unread anywhere in the
 * API, so sending it from a filtered view would irreversibly mark hundreds of
 * events the operator cannot see. With any filter active the request carries
 * explicit ids instead, and the button says what it will do before the click.
 * (Coord's earlier "absent body = mark all" spelling is gone: it made a
 * camelCase typo destroy a tenant's entire read state.)
 *
 * Degrade: coord answers `503 schema_migration_pending` on both routes until
 * the `coord.notifications` alembic revision deploys, and the coord PR lands
 * AFTER this one by design. That state renders as a quiet "not available yet"
 * note, never an error — and every call here opts out of `HttpClient`'s 5xx
 * retry for 503 (`NOTIFICATIONS_REQUEST_OPTIONS`). Retrying a deliberate,
 * days-long answer costs a measured 5 requests over ~15s, which this page's
 * 10s poller would overlap with itself while the first paint sat behind a
 * skeleton for the whole chain.
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * This route landed AFTER the console plan was authored and was missing from
 * its census — see that plan's §4 correction. Migrated per
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Notifications`
 *   wrapper is gone; `coord/layout.tsx` already renders the console `<h1>`.
 * - **R1** — a `<HealthStrip>` opens the page. Its counts are coord's own
 *   server-computed `total` / `unread_count` scalars, which this page ALREADY
 *   holds — not `rows.length`, which would report the page size, the exact
 *   misread the notifications plan exists to stop. The `N unread` / `N total`
 *   badges that were in the card title are those two counts.
 * - **R2/R5** — `<NotificationRow>` moved onto `<RecordRow>` /
 *   `<RecordDetail>` in the same commit. It was already row-shaped and already
 *   expanded in place; what changed is that it is the shared implementation
 *   rather than a second copy.
 * - **R6** — the list renders through `<RecordList>`, so an in-flight first
 *   read shows skeletons rather than an empty list asserting there is nothing;
 *   and the two count badges render `–` rather than `0` in every state where
 *   coord has not answered. That is what the second `loaded` flag below is
 *   for: `loading` settles on FAILURE too (it is cleared in a `finally`),
 *   which is right for the skeleton and wrong for a count.
 *
 *   **A THIRD flag, `readFailed`, was added by the post-merge audit of this
 *   wave.** `loaded` answers "did anything ever arrive" and `error` answers "is
 *   anything wrong on this page" — and neither answers the question a 10s
 *   poller makes urgent: *are the numbers on screen still current?* Without it
 *   a good first load followed by failing polls left a GREEN "137 unread
 *   events" sitting directly above this page's own "Failed to load…" line.
 *   R6's own note in the style guide now carries the general rule; the split
 *   it produces here is unknown (`–`, nothing ever read) versus stale (the
 *   real numbers, said to have stopped moving).
 *
 *   **A failed read has FOUR consumers on this page, and the commit that added
 *   `readFailed` wired one.** The others each made the same
 *   confident-false-claim in their own idiom:
 *
 *   - the `empty=` slot said "No notifications matching filters." after a read
 *     that never landed — the fabricated absence, made in words instead of a
 *     number, two elements under a strip that correctly said it could not read
 *     the feed. It now goes through the console's shared `readIsUnknown`, so
 *     the strip and the slot cannot drift apart;
 *   - the `?ref=` banner consulted `error`, which mark-read also writes, so a
 *     rejected POST made it blame the feed;
 *   - the mark-all tooltip promised "Marks ALL 137 unread… cannot be undone"
 *     off a count the strip was simultaneously labelling frozen — a stale
 *     number in front of an IRREVERSIBLE action.
 *
 *   **And the sweep that counted those four consumers re-spelled the
 *   predicate twice while fixing them** — the follow-up audit's finding, and
 *   the same shape one level in:
 *
 *   - the tooltip's staleness guard was `readFailed`, which is three of the
 *     FOUR ways coord's scalars stop being quotable. Under
 *     `migrationPending` — reachable after any good read, since the strip's
 *     own arm for it renders both badges `–` — it promised "Marks ALL 137
 *     unread… cannot be undone" about a number the page was simultaneously
 *     calling unknown. The strip is the surface that decides this, so it now
 *     publishes the answer as `health.readIsCurrent` and the tooltip asks
 *     rather than re-derives. The same state also left the button LIVE in
 *     front of a POST that can only 503, which this page swallows as the quiet
 *     degrade — a button that silently does nothing;
 *   - `pagingFailed` was split out of `readFailed` so a failed page would not
 *     stale the strip, and then folded straight back into one boolean at the
 *     `?ref=` banner. A failed "Load more" therefore reported "the feed above
 *     failed to load" about a feed the strip was painting green, and withheld
 *     the one remedy that applies — retrying the button. It is its own arm,
 *     ranked below the head failure, because when both are true the head is
 *     the bigger truth.
 *
 *   **And one flag was the wrong grain.** `loaded` is page-lifetime, so a
 *   success under one filter licensed an empty-state claim about a DIFFERENT
 *   filter whose read had failed — the same bug, one state over. The list is
 *   query-scoped and now reads `queryLoaded`; the strip keeps `loaded`,
 *   because its `unread_count` is a per-principal scalar that does not move
 *   with the filter.
 *
 * **The strip is never red or amber for a BACKLOG**, and that is the point:
 * this is an append-only EVENT feed, so an unread row blocks nobody and decays
 * into nothing. Amber would promise something else clears it; red would claim
 * "act now". Both are false. It IS amber whenever it cannot say what happened —
 * migration-pending, a first read that failed, before the first answer, a read
 * that answered without `unread_count`, and counts a since-failing poll left
 * standing. See `notificationsHealth.tsx`.
 *
 * **The kind filter and the unread-only switch deliberately stay a `<Select>`
 * and a `<Switch>`, not `<FilterTabs>`.** Both are SERVER-side (`?kind=`,
 * `?unread_only=`) and change what is fetched, so every tab but the active one
 * would carry `–` forever — the precedent `/plans` set in Wave 1. They are
 * also frozen authored testids (D4a). The counts an operator wants are in the
 * strip, taken from coord's scalars rather than from the loaded page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CheckCheck, Filter, RefreshCw } from "lucide-react";
import {
  HealthStrip,
  RecordList,
  createReadSequence,
  readIsUnknown,
} from "@/components/console";
import { NotificationRow } from "@/components/admin/coord/NotificationRow";
import { deriveNotificationsHealth } from "@/components/admin/coord/notificationsHealth";
import {
  type CoordNotificationRow,
  type MarkReadResponse,
  type MarkReadSelection,
  type NotificationsResponse,
  MARK_ALL,
  NOTIFICATIONS_REQUEST_OPTIONS,
  humanKind,
  isContractError,
  isMigrationPending,
  isUnread,
  kindOptions,
  linkedRefNotice,
  matchesNotificationRef,
  mergeKindVocabulary,
  selectionIds,
} from "@/components/admin/coord/notificationStatus";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;
/** Page size asked of coord. Coord owns the clamp; this is a request. */
const PAGE_SIZE = 50;

function buildQuery(params: {
  kind: string;
  unreadOnly: boolean;
  cursor?: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set("limit", String(PAGE_SIZE));
  if (params.kind !== "any") qs.set("kind", params.kind);
  if (params.unreadOnly) qs.set("unread_only", "true");
  if (params.cursor) qs.set("cursor", params.cursor);
  return qs.toString();
}

export default function CoordNotificationsPage() {
  const [kind, setKind] = useState("any");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [rows, setRows] = useState<CoordNotificationRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  /**
   * True once a read has SUCCEEDED — never merely "a read finished".
   *
   * `loading` is cleared in a `finally`, so it settles on failure too: exactly
   * what the SKELETON wants (stop spinning) and exactly what the COUNTS must
   * not use (a failed first read would fall through to `0 unread`, which is a
   * claim we have not earned). Two flags, two questions — the split `/history`
   * documents and Wave 2 propagated to /lands, /deploys, /agents and
   * /releases.
   */
  const [loaded, setLoaded] = useState(false);
  /**
   * True while the MOST RECENT head read failed. Not `error`, and not `!loaded`.
   *
   * `error` is the page's one error line and mark-read writes to it too, so it
   * answers "is anything wrong here", which is a different question from "are
   * the counts in the strip still current". `loaded` answers "did anything ever
   * arrive". Neither can express the state that matters most on a 10s poller:
   * a first load that WORKED followed by polls that stopped working, which
   * leaves real numbers on screen with nothing saying they froze.
   *
   * Crossed with `loaded`, this is the strip's two-arm unknown-vs-stale split —
   * see `notificationsHealth.tsx`. Cleared on every success, so a poll that
   * recovers un-stales the strip without a reload.
   */
  const [readFailed, setReadFailed] = useState(false);
  /**
   * Has the query CURRENTLY on screen answered? Reset by the filter effect.
   *
   * `loaded` above is page-lifetime — it is never set back to false — which is
   * right for the strip, whose `unread_count` is a per-principal scalar that
   * does not move with the filter. It is wrong for the LIST, which is entirely
   * query-scoped: a success under `kind=policy_change` says nothing about
   * whether `kind=gate_opened` has rows, so carrying that `loaded` across the
   * switch lets a failed read of the NEW filter render "No notifications
   * matching filters." — the same fabricated absence, one state over.
   *
   * This is what makes `readIsUnknown`'s "coord has CONFIRMED this window
   * empty" premise actually true at the slot that relies on it: the
   * confirmation has to be about the window being described, not about an
   * earlier one. Within a generation it behaves exactly like `loaded`, so the
   * anti-flicker property is unchanged — a blipped poll on a genuinely empty
   * filter still reads "nothing matches", not "unknown".
   */
  const [queryLoaded, setQueryLoaded] = useState(false);
  /**
   * The last PAGING read failed. Deliberately not folded into `readFailed`.
   *
   * `readFailed` is the state of the last HEAD read, and the strip is derived
   * from it: a failed "Load more" must not paint the head counts stale, since
   * the 10s poller is still refreshing them. But the `?ref=` banner asks a
   * different question — *did we manage to look everywhere* — and for that a
   * failed page IS a failed look. Without this it tells the operator the event
   * "may be older than these — load more", pointing at the button that just
   * failed.
   */
  const [pagingFailed, setPagingFailed] = useState(false);
  /**
   * The most recent SUCCESSFUL head read carried no `unread_count`, while an
   * earlier one did — so the scalars on screen are frozen even though nothing
   * failed.
   *
   * `applyEnvelope` below treats an absent scalar as UNKNOWN and leaves the
   * previous value standing, which is right; what was missing is anyone SAYING
   * so. `readFailed` is false (the read landed) and `loaded` is true, so the
   * strip took the green arm and reported a number from an earlier read as
   * current, and the mark-all tooltip promised it.
   *
   * Found from the other end: the nav badge polls this same route on its own
   * timer and had the identical hole, so it was fixed there first — leaving the
   * page, briefly, the LESS careful of two surfaces reading one scalar.
   */
  const [scalarStale, setScalarStale] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<string[]>([]);

  /**
   * `?ref=<id>` — the deep link the landed-write feed on
   * `/admin/coord/prompt-document-proposals` uses to reach the event that
   * announced one write, and the reasoning its author recorded (plan
   * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
   *
   * Read once on mount from `window.location` rather than `useSearchParams`,
   * which would force this client page behind a Suspense boundary for a
   * one-shot read — the same call `/admin/coord/gates?gate=<id>` makes.
   *
   * It expands a row; it does NOT become a filter. `filterActive` below governs
   * the blast radius of mark-all-read, and quietly widening what counts as a
   * filter would change what that button does.
   */
  const [linkedRef, setLinkedRef] = useState<string | null>(null);
  const linkedApplied = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setLinkedRef(ref);
  }, []);

  /**
   * Generation counter for "the query currently on screen". The effect below
   * bumps it whenever the filters change; every request captures its value at
   * call time and drops its response if the value has moved on.
   *
   * Without it a reply still in flight when the operator switches filters
   * prepends the OLD filter's rows into the new list and — worse — calls
   * `setNextCursor` with a cursor minted under filter A while the page now
   * queries filter B, so the next "Load more" pages through the wrong query.
   * The 503 short-circuit narrows this window a lot (a retried 503 held a
   * request open for ~15s), but narrowing a race is not closing it.
   */
  const queryGenRef = useRef(0);

  /**
   * Whether `unread_count` on screen came from the most recent read that could
   * have carried it — as a SEQUENCE, through the console's shared module rather
   * than a boolean this page spells for itself.
   *
   * Three writers touch that scalar and none of them ordered: the head read,
   * `loadMore`, and `markRead`'s POST response. A flag was enough while only
   * one of them wrote it; it stopped being enough the moment the POST started
   * clearing it, because a POST that hangs past a head read can then land and
   * report "current" about a number the newer read declined to confirm.
   * `createReadSequence` is the same arithmetic `CoordNav`'s badges run — R6's
   * own "import the predicate, do not re-spell it", applied to the module this
   * page's audit produced.
   *
   * A ref, because a settling read has to see its own writes in the same tick.
   *
   * This page reads `isStale()` and never `hasDelivered()` — `unreadCount ===
   * null` is the same question here, and provably so: `setUnreadCount` runs iff
   * `settle(…) && carried`, which is exactly when the module advances
   * `delivered`. Stated rather than left to be rediscovered, because two
   * spellings of one fact is what this module exists to stop.
   */
  const scalarSeqRef = useRef<ReturnType<typeof createReadSequence> | null>(
    null
  );
  if (scalarSeqRef.current === null) {
    scalarSeqRef.current = createReadSequence();
  }

  /**
   * `fromHead` is not cosmetic. `applyEnvelope` now writes a staleness VERDICT
   * as well as values, and only the head read is entitled to one.
   *
   * `pagingFailed` exists in this file precisely because "a failed Load more
   * must not paint the head counts stale, since the 10s poller is still
   * refreshing them" — and writing `scalarStale` from a paging response
   * reintroduced that coupling through the other door: a cursor page answering
   * without the scalar flipped a green strip to "These counts stopped
   * updating" and dropped the figure from the mark-all tooltip, as a direct
   * result of the operator's own click, self-healing only on the next tick.
   * Values are still applied from either path — they are server scalars for
   * the same query — but the verdict follows the read the strip is derived
   * from.
   */
  const applyEnvelope = useCallback(
    (body: NotificationsResponse, seq: number, fromHead: boolean) => {
      const sequence = scalarSeqRef.current!;
      // Scalars, never `notifications.length`. Absence is UNKNOWN, so the
      // previous value stands rather than silently reading zero — and, since
      // standing silently is what made the strip quote a frozen number as
      // current, absence now also says so.
      if (typeof body.total === "number") setTotal(body.total);
      const carried = typeof body.unread_count === "number";
      // `counts: fromHead` is the whole of the paging fix. A cursor page can
      // still DELIVER the scalar, but its silence says nothing — `pagingFailed`
      // exists in this file precisely because "a failed Load more must not
      // paint the head counts stale, since the 10s poller is still refreshing
      // them", and letting a page's silence stale them brought that coupling
      // back through the other door.
      if (sequence.settle(seq, carried, fromHead) && carried) {
        setUnreadCount(body.unread_count!);
      }
      // The first read to answer WITHOUT the scalar is not a read that stopped
      // carrying it: `isStale()` stays false until something has been
      // delivered, so that state keeps its own arm and its own sentence ("The
      // unread count did not come back") instead of being told it is a number
      // that has gone out of date.
      setScalarStale(sequence.isStale());
    },
    []
  );

  /** Fetch the head page. `merge` keeps already-loaded later pages. */
  const fetchHead = useCallback(
    async (merge: boolean) => {
      const gen = queryGenRef.current;
      // Taken BEFORE the request goes out, so the ticket orders reads by when
      // they were issued rather than by when they happened to come back.
      const scalarSeq = scalarSeqRef.current!.issue();
      try {
        const body = await httpClient.get<NotificationsResponse>(
          `${API}/notifications?${buildQuery({ kind, unreadOnly })}`,
          NOTIFICATIONS_REQUEST_OPTIONS
        );
        if (queryGenRef.current !== gen) return;
        const page = body.notifications ?? [];
        setRows((prev) => {
          if (!merge) return page;
          const seen = new Set(page.map((n) => n.notification_id));
          return [...page, ...prev.filter((n) => !seen.has(n.notification_id))];
        });
        setVocabulary((prev) => mergeKindVocabulary(prev, page));
        if (!merge) {
          // A head read that does not merge THROWS THE WALK AWAY and starts a
          // new one, so the old walk's failure goes with it. The filter effect
          // already resets this before calling us; Refresh calls the same
          // function and did not, so a failed "Load more" survived a Refresh
          // that had discarded the very pages it was talking about — and if the
          // new head answered with no cursor, the banner pointed at a "Load
          // more" button that is no longer rendered. Reset beside the cursor it
          // belongs to, so the two callers of this path cannot disagree again.
          setNextCursor(body.next_cursor ?? null);
          setPagingFailed(false);
        }
        applyEnvelope(body, scalarSeq, true);
        setMigrationPending(false);
        setLoaded(true);
        // This query has now answered — the list may speak for it.
        setQueryLoaded(true);
        setError(null);
        setReadFailed(false);
      } catch (e) {
        // The guard covers the failure arms too: a stale 503 must not flip the
        // new query's view to "not available yet", and a stale 500 must not
        // stamp an error over a query that is fine.
        if (queryGenRef.current !== gen) return;
        if (isMigrationPending(e)) {
          // Expected until the coord migration deploys — not an error, and not
          // a stale-counts state either: `migrationPending` is checked first by
          // the strip and speaks for itself.
          setMigrationPending(true);
          setError(null);
          setReadFailed(false);
        } else {
          setError(
            `Failed to load: ${e instanceof Error ? e.message : String(e)}`
          );
          setReadFailed(true);
        }
      } finally {
        if (queryGenRef.current === gen) setLoading(false);
      }
    },
    [kind, unreadOnly, applyEnvelope]
  );

  // Keyset paging: `next_cursor` is opaque and only meaningful for the query
  // that produced it, which is why a filter change resets the walk below.
  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!cursor) return;
    const gen = queryGenRef.current;
    const scalarSeq = scalarSeqRef.current!.issue();
    setLoadingMore(true);
    try {
      const body = await httpClient.get<NotificationsResponse>(
        `${API}/notifications?${buildQuery({ kind, unreadOnly, cursor })}`,
        NOTIFICATIONS_REQUEST_OPTIONS
      );
      if (queryGenRef.current !== gen) return;
      const page = body.notifications ?? [];
      setRows((prev) => {
        const seen = new Set(prev.map((n) => n.notification_id));
        return [...prev, ...page.filter((n) => !seen.has(n.notification_id))];
      });
      setVocabulary((prev) => mergeKindVocabulary(prev, page));
      // An empty page ends the walk even if coord still hands back a cursor —
      // otherwise a fully-deduped page leaves an enabled button that does
      // nothing when clicked.
      setNextCursor(page.length === 0 ? null : (body.next_cursor ?? null));
      applyEnvelope(body, scalarSeq, false);
      setError(null);
      setPagingFailed(false);
    } catch (e) {
      if (queryGenRef.current !== gen) return;
      if (isMigrationPending(e)) setMigrationPending(true);
      else {
        setError(
          `Failed to load: ${e instanceof Error ? e.message : String(e)}`
        );
        // NOT `setReadFailed` — the head counts are still being refreshed by
        // the poller, so staling the strip for a failed page would be a claim
        // of its own. What this does invalidate is "we looked at everything
        // that is loadable".
        setPagingFailed(true);
      }
    } finally {
      if (queryGenRef.current === gen) setLoadingMore(false);
    }
  }, [kind, unreadOnly, nextCursor, applyEnvelope]);

  // Filter change resets the page walk — a cursor is only meaningful within
  // the query that produced it — and retires every response still in flight
  // for the previous filter.
  useEffect(() => {
    queryGenRef.current += 1;
    setLoading(true);
    setRows([]);
    // The new query has answered nothing yet, and no page of it has failed.
    // `loaded` is deliberately NOT reset — see its declaration.
    setQueryLoaded(false);
    setPagingFailed(false);
    setNextCursor(null);
    setExpanded(null);
    fetchHead(false);
    const id = setInterval(() => fetchHead(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHead]);

  const markRead = useCallback(
    async (selection: MarkReadSelection, bulk = false) => {
      const gen = queryGenRef.current;
      const scalarSeq = scalarSeqRef.current!.issue();
      const ids = selectionIds(selection);
      setMarking(bulk || ids === null ? "all" : (ids[0] ?? "all"));
      try {
        // The selection object IS the wire body — `{notification_ids: [...]}`
        // or `{all: true}`, snake_case, never both keys. Coord rejects
        // anything else with a 400 rather than falling back to mark-all.
        const body = await httpClient.post<MarkReadResponse>(
          `${API}/notifications/mark-read`,
          selection,
          NOTIFICATIONS_REQUEST_OPTIONS
        );
        if (queryGenRef.current !== gen) return;
        const now = new Date().toISOString();
        const target = ids === null ? null : new Set(ids);
        setRows((prev) =>
          prev.map((n) =>
            !isUnread(n) || (target && !target.has(n.notification_id))
              ? n
              : { ...n, read_at: now }
          )
        );
        // The mark-read door is a DELIVERY of this scalar — coord computed it
        // for this principal just now — and the bookkeeping has to say so. It
        // was left out when `applyEnvelope` became the sole author of the
        // verdict, and a later "have we ever seen one?" gate then made the
        // omission PERMANENT in one direction: against a feed that never
        // carries the scalar, a mark-all wrote a real `0` into state while the
        // gate stayed shut, so nothing could ever stale it again and the strip
        // settled into a green "you have seen everything coord recorded" over a
        // number the FEED has never delivered.
        //
        // `counts: false` is what keeps it a delivery WITHOUT making it a read:
        // this is a write's response, so it can carry the scalar as a courtesy,
        // but its silence says nothing about the feed and must never stale the
        // strip. And going through the sequence at all is what stops the
        // reverse — a POST that hangs past a newer head read landing afterwards
        // and reporting "current" about a number that read declined to confirm.
        const scalarCarried = typeof body?.unread_count === "number";
        const sequence = scalarSeqRef.current!;
        if (sequence.settle(scalarSeq, scalarCarried, false) && scalarCarried) {
          setUnreadCount(body.unread_count!);
        }
        setScalarStale(sequence.isStale());
        setError(null);
        // `unread_only` view: marked rows no longer match the filter.
        if (unreadOnly) fetchHead(false);
      } catch (e) {
        if (queryGenRef.current !== gen) return;
        const message = e instanceof Error ? e.message : String(e);
        if (isContractError(e)) {
          // A rejected BODY, not an unavailable server. Loud on purpose: the
          // alternative is a button that silently does nothing forever.
          setError(
            `Could not mark read — the request was rejected (${message}). ` +
              "That is a client/contract bug, not a coord outage."
          );
        } else if (isMigrationPending(e)) {
          setMigrationPending(true);
        } else {
          setError(`Could not mark read: ${message}`);
        }
      } finally {
        setMarking(null);
      }
    },
    [unreadOnly, fetchHead]
  );

  const kinds = useMemo(
    () => kindOptions(vocabulary, kind),
    [vocabulary, kind]
  );

  /**
   * The linked row, if it is on the page that is loaded.
   *
   * `null` while a `linkedRef` is set is a real, reportable state — the event
   * may be older than the loaded page, or excluded by the current filter — and
   * the banner says which rather than leaving the operator on an ordinary feed
   * wondering whether the link worked.
   */
  const linkedMatch = useMemo(() => {
    if (!linkedRef) return null;
    return (
      rows.find((n) => matchesNotificationRef(n, linkedRef))?.notification_id ??
      null
    );
  }, [rows, linkedRef]);

  // One-shot: expand the linked row when it first arrives. Guarded so a later
  // poll cannot re-open a row the operator has since collapsed.
  useEffect(() => {
    if (!linkedMatch || linkedApplied.current) return;
    linkedApplied.current = true;
    setExpanded(linkedMatch);
  }, [linkedMatch]);

  const health = deriveNotificationsHealth({
    unreadCount,
    total,
    loaded,
    migrationPending,
    // `readFailed`, not `error !== null && !loaded`. The old expression could
    // only ever describe a FIRST read that failed, so the far more common
    // state — a good first load followed by polls that stopped succeeding —
    // fell through to the green arm and reported frozen counts as current.
    // It also folded in mark-read failures, which say nothing about whether
    // the counts are fresh.
    failed: readFailed,
    // ...and the third way they stop being current, which neither of the two
    // above can express: a read that LANDED carrying no scalar.
    scalarStale,
  });

  /**
   * Mark-read-in-bulk, and what it will actually do.
   *
   * `{notification_ids: null}` means "every unread row for this principal",
   * fleet-wide across every kind. Sending that from a FILTERED view is a trap:
   * an operator looking at 4 rows of one kind clicks a button labelled "Mark
   * all read" and silently marks the several hundred unread events they cannot
   * see — and there is no mark-UNREAD anywhere in the API, so it cannot be
   * undone. So the scope follows the view: with any filter active the request
   * carries the explicit ids of the loaded unread rows, and the label says so
   * BEFORE the click rather than the toast saying so after.
   */
  const filterActive = kind !== "any" || unreadOnly;
  /**
   * Through the module's `isUnread`, not a fourth `!n.read_at`.
   *
   * The same R6 rule the rest of this page was just fixed for, applied to the
   * predicate that decides which rows the FILTERED arm irreversibly marks.
   * `notificationStatus.ts` exports the one spelling of "unread" and
   * `NotificationRow` imports it to decide how a row renders; this page had
   * three hand-rolled copies deciding what a click destroys, so the row and
   * the button could have disagreed about the same row. That the current
   * spellings happen to match is not the property worth having — "unread ⇔
   * no `read_at` for this principal" is coord's contract, and it belongs in
   * one place for the same reason `readIsUnknown` does.
   */
  const loadedUnreadIds = useMemo(
    () => rows.filter(isUnread).map((n) => n.notification_id),
    [rows]
  );
  /**
   * The number the tooltip is allowed to promise — the FOURTH consumer of that
   * failed poll, and the one where being confidently wrong costs the most.
   *
   * Unfiltered, this is coord's `unread_count`, which is only ever as good as
   * the read that delivered it. The strip is the surface that decides that, so
   * the guard is `health.readIsCurrent` rather than a second spelling here:
   * the first cut wrote `readFailed`, which covers the stale arm and misses
   * `migrationPending` — where the strip renders both badges as `–` and the
   * tooltip, one element away, still promised "Marks ALL 137 unread
   * notifications… This cannot be undone". A stale number is bad in front of an
   * IRREVERSIBLE action; a number the page is simultaneously calling unknown is
   * worse. So whenever the counts are not current the tooltip drops the figure
   * and keeps the warning — the unfiltered arm marks every unread row for this
   * principal regardless of what the number says, which is exactly why the
   * number must not be the reassuring part.
   *
   * The filtered arm is unaffected: it counts LOADED rows, which are not a
   * coord scalar and cannot go stale behind our back.
   */
  const markAllCount = filterActive
    ? loadedUnreadIds.length
    : health.readIsCurrent
      ? unreadCount
      : null;
  /**
   * Under `migrationPending` there is no table to mark, so the POST is a
   * guaranteed 503 that this page swallows as the quiet degrade — a button that
   * silently does nothing, which is the outcome `isContractError` exists to
   * avoid one arm over. Disabled outright rather than left live off a count
   * from before the table went away. The Refresh button deliberately stays
   * enabled: it is the recovery path, not a write.
   *
   * `migrationPending` and NOT `health.readIsCurrent`, one line under a fix for
   * re-spelling — because they answer different questions and only one of them
   * is this button's. `readIsCurrent` is false on a failed poll too, and a
   * stale count is no reason to refuse the write: the unfiltered arm marks
   * every unread row regardless of any number, so it still does the right thing
   * against a feed that has stopped answering. What stops it here is that the
   * STORE cannot be written, which is a fact about coord's deployment rather
   * than about the freshness of a read.
   */
  /**
   * The unfiltered arm, and the one `?? 0` this page had left standing.
   *
   * `!((unreadCount ?? 0) > 0 || rows.some(unread))` reads a MISSING count as
   * zero, which is the fabrication `notificationsHealth.tsx` exists to stop —
   * made here in an affordance instead of in words. After a first read that
   * failed, `unreadCount` is `null` and `rows` is `[]`, so the strip says
   * "Could not read the feed", the list says "whether anything is waiting for
   * you is unknown, not none", and between them the button greyed itself out:
   * a third surface answering the same question, and the only one answering it
   * confidently, wrongly, and without a sentence anyone could argue with.
   *
   * The disable now needs a REASON the page actually holds, which is exactly
   * the standard the `migrationPending` line above was argued to: *the STORE
   * cannot be written*. Not knowing the count is not such a reason — the
   * unfiltered arm sends `{all: true}` and coord marks every unread row for
   * this principal regardless of any number we hold, so an unknown count
   * costs the request nothing. If there is genuinely nothing unread the POST
   * is a no-op that answers `marked: 0`; if the feed is merely unreadable it
   * does the work the operator asked for. Neither outcome is the silent
   * nothing a disabled button promises.
   *
   * So: disabled only on an AFFIRMATIVE zero — coord's scalar actually said
   * `0`, THE READ THAT DELIVERED IT IS CURRENT, and no loaded row contradicts
   * it. Every other state keeps the button live, which is the same direction
   * §2's reasoning already took ("a stale count is no reason to refuse the
   * write").
   *
   * `health.readIsCurrent` is that middle term and it is not optional. Without
   * it this predicate reads a RETAINED zero as knowledge: `applyEnvelope` keeps
   * the previous scalar when a poll fails, so a feed that answered `0` and then
   * went dark leaves a frozen `0` in state while new events arrive — and the
   * button greys out under a strip headlined "These counts stopped updating"
   * whose detail line says, in words, "what has arrived since the last good
   * read is UNKNOWN". That is the same defect one state over, and re-deriving
   * "may I quote this scalar?" from the raw value is exactly what R6's fourth
   * rule forbids: the strip owns that verdict and publishes it, two
   * declarations above, where `markAllCount` already consults it.
   */
  const knownNothingUnread =
    health.readIsCurrent && unreadCount === 0 && !rows.some(isUnread);
  const markAllDisabled =
    migrationPending ||
    (filterActive ? loadedUnreadIds.length === 0 : knownNothingUnread);
  const markAllLabel = filterActive
    ? `Mark ${loadedUnreadIds.length} shown read`
    : "Mark all read";
  const markAllTitle = filterActive
    ? `Marks only the ${loadedUnreadIds.length} unread row(s) loaded under the current filter.`
    : markAllCount != null
      ? `Marks ALL ${markAllCount} unread notifications, including kinds not shown here. This cannot be undone.`
      : "Marks ALL unread notifications, including kinds not shown here. This cannot be undone.";

  /**
   * The read failed and coord has never answered — so the LIST is unknown too,
   * not empty.
   *
   * The same two booleans the strip is derived from, through the same shared
   * predicate, because they have to agree: the wave shipped a page that would
   * say "Could not read the feed" in the strip and, two elements below,
   * "No notifications matching filters." in the list — the very
   * confident-false-claim the strip was just fixed to stop making, left
   * standing in the slot that makes it in WORDS.
   *
   * It is the ordinary failed-first-load state, not a corner: `loading` is
   * cleared in a `finally` so it settles on failure, and `rows` is `[]`, so
   * `RecordList`'s `loaded` prop below is `true` and the `empty` node renders.
   *
   * Keyed on `queryLoaded` rather than on `rows.length`, per `readIsUnknown`'s
   * own reasoning: a filter whose window is genuinely empty must not flip to
   * "unknown" and back on every blipped poll. `queryLoaded` rather than
   * `loaded` because the premise that reasoning rests on — "coord has
   * CONFIRMED this window empty" — is only true of the window currently being
   * described; see its declaration.
   */
  const feedUnknown = readIsUnknown(queryLoaded, readFailed);

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-notifications-page"
    >
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-notifications-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger
            className="w-[190px]"
            data-testid="coord-notifications-kind-select"
          >
            <SelectValue placeholder="kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All kinds</SelectItem>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>
                {humanKind(k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-2 flex items-center gap-1.5">
          <Switch
            id="unread-only"
            checked={unreadOnly}
            onCheckedChange={setUnreadOnly}
            data-testid="coord-notifications-unread-only"
          />
          <label
            htmlFor="unread-only"
            className="text-xs text-muted-foreground"
          >
            unread only
          </label>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            markRead(
              filterActive ? { notification_ids: loadedUnreadIds } : MARK_ALL,
              true
            )
          }
          disabled={markAllDisabled || marking !== null}
          title={markAllTitle}
          data-testid="coord-notifications-mark-all-read"
          data-mark-all-scope={filterActive ? "loaded" : "everything"}
        >
          <CheckCheck className="mr-1 h-3 w-3" />
          {markAllLabel}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchHead(false)}
          data-testid="coord-notifications-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Callers supply the whole sentence — a mark-read rejection is not
          a "failed to load". */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {linkedRef && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="coord-notifications-linked-ref"
        >
          {linkedRefNotice({
            found: Boolean(linkedMatch),
            // The same predicate `RecordList`'s `loaded` uses below — nothing
            // has been read yet, so "not on this page" would be a claim
            // rather than a fact.
            loading: loading && rows.length === 0,
            // Not `error`. This arm says "the feed above failed to load", and
            // `error` is the page's ONE error line — mark-read writes to it
            // too, so a rejected POST made the banner blame a feed that had
            // loaded perfectly well.
            error: readFailed,
            // The paging arm needs this to keep the filter clause it would
            // otherwise drop — see `linkedRefNotice`. Deliberately the SAME
            // `filterActive` that scopes mark-all, so "a filter is on" means
            // one thing on this page.
            filterActive,
            // …and NOT folded into the line above, for the same reason the
            // strip keeps them apart. `readFailed || pagingFailed` made a
            // failed "Load more" report "the feed above failed to load" about a
            // feed the strip was simultaneously painting green — the two states
            // want different sentences and different remedies.
            pagingFailed,
            migrationPending,
          })}
        </p>
      )}

      {migrationPending ? (
        // Quiet degrade — the table does not exist in coord yet.
        <p
          className="text-sm italic text-muted-foreground"
          data-testid="coord-notifications-pending"
        >
          Notifications are not available yet.
        </p>
      ) : (
        <>
          <RecordList
            items={rows}
            itemKey={(n) => n.notification_id}
            // R6 applied to a list: an in-flight FIRST read renders skeletons,
            // never an empty list claiming there is nothing. A later poll that
            // fails leaves the rows we have.
            loaded={!(loading && rows.length === 0)}
            skeletonRows={8}
            expandedKey={expanded}
            onExpandedKeyChange={setExpanded}
            empty={
              feedUnknown ? (
                // R6 at the slot where the claim is actually made in words —
                // the shape `/spawn`, `/plans` and `/agents/[agent_id]` already
                // carry. With the read failed and nothing retained, "nothing
                // unread" is a statement about coord's availability wearing the
                // clothes of a statement about the feed.
                <p
                  className="text-sm italic text-muted-foreground"
                  data-testid="coord-notifications-unknown"
                >
                  Could not read the feed — whether anything is waiting for you
                  is unknown, not none.
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  {unreadOnly
                    ? "Nothing unread."
                    : "No notifications matching filters."}
                </p>
              )
            }
            renderRow={(n, ctx) => (
              <NotificationRow
                notification={n}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
                onMarkRead={() =>
                  markRead({ notification_ids: [n.notification_id] })
                }
                markPending={marking === n.notification_id}
              />
            )}
          />
          {nextCursor && rows.length > 0 && (
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
                data-testid="coord-notifications-load-more"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
