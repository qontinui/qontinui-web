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
import { HealthStrip, RecordList, readIsUnknown } from "@/components/console";
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

  const applyEnvelope = useCallback((body: NotificationsResponse) => {
    // Scalars, never `notifications.length`. Absence is UNKNOWN, so the
    // previous value stands rather than silently reading zero.
    if (typeof body.total === "number") setTotal(body.total);
    if (typeof body.unread_count === "number")
      setUnreadCount(body.unread_count);
  }, []);

  /** Fetch the head page. `merge` keeps already-loaded later pages. */
  const fetchHead = useCallback(
    async (merge: boolean) => {
      const gen = queryGenRef.current;
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
        if (!merge) setNextCursor(body.next_cursor ?? null);
        applyEnvelope(body);
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
      applyEnvelope(body);
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
            n.read_at || (target && !target.has(n.notification_id))
              ? n
              : { ...n, read_at: now }
          )
        );
        if (typeof body?.unread_count === "number") {
          setUnreadCount(body.unread_count);
        }
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
  const loadedUnreadIds = useMemo(
    () => rows.filter((n) => !n.read_at).map((n) => n.notification_id),
    [rows]
  );
  /**
   * The number the tooltip is allowed to promise — the FOURTH consumer of that
   * failed poll, and the one where being confidently wrong costs the most.
   *
   * Unfiltered, this is coord's `unread_count`, and `readFailed` means it is
   * whatever an earlier read left behind. The strip is already labelling it
   * frozen; a tooltip one element away saying "Marks ALL 137 unread
   * notifications… This cannot be undone" spends that stale number in front of
   * an IRREVERSIBLE action. So when the count is stale the tooltip drops the
   * figure and keeps the warning — the unfiltered arm marks every unread row
   * for this principal regardless of what the number says, which is exactly
   * why the number must not be the reassuring part.
   *
   * The filtered arm is unaffected: it counts LOADED rows, which are not a
   * coord scalar and cannot go stale behind our back.
   */
  const markAllCount = filterActive
    ? loadedUnreadIds.length
    : readFailed
      ? null
      : unreadCount;
  const markAllDisabled = filterActive
    ? loadedUnreadIds.length === 0
    : !((unreadCount ?? 0) > 0 || rows.some((n) => !n.read_at));
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
  });

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
            // loaded perfectly well. But the question here is wider than the
            // strip's: the banner's fallback tells the operator to "load
            // more", so a failed PAGE is a failed look even though it leaves
            // the head counts fresh.
            error: readFailed || pagingFailed,
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
