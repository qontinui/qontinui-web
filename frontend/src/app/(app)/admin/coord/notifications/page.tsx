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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCheck, Filter, RefreshCw } from "lucide-react";
import { NotificationRow } from "@/components/admin/coord/NotificationRow";
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
        setError(null);
      } catch (e) {
        // The guard covers the failure arms too: a stale 503 must not flip the
        // new query's view to "not available yet", and a stale 500 must not
        // stamp an error over a query that is fine.
        if (queryGenRef.current !== gen) return;
        if (isMigrationPending(e)) {
          // Expected until the coord migration deploys — not an error.
          setMigrationPending(true);
          setError(null);
        } else {
          setError(
            `Failed to load: ${e instanceof Error ? e.message : String(e)}`
          );
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
    } catch (e) {
      if (queryGenRef.current !== gen) return;
      if (isMigrationPending(e)) setMigrationPending(true);
      else
        setError(
          `Failed to load: ${e instanceof Error ? e.message : String(e)}`
        );
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
  const markAllCount = filterActive ? loadedUnreadIds.length : unreadCount;
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

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-notifications-page"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notifications
            {unreadCount != null && unreadCount > 0 && (
              <Badge data-testid="coord-notifications-unread-count">
                {unreadCount} unread
              </Badge>
            )}
            {total != null && (
              <Badge
                variant="outline"
                data-testid="coord-notifications-total"
                className="font-normal"
              >
                {total} total
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
                  filterActive
                    ? { notification_ids: loadedUnreadIds }
                    : MARK_ALL,
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
                // Same predicate the Skeleton below uses — nothing has been
                // read yet, so "not found" would be a claim, not a fact.
                loading: loading && rows.length === 0,
                error: Boolean(error),
              })}
            </p>
          )}

          {loading && rows.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : migrationPending ? (
            // Quiet degrade — the table does not exist in coord yet.
            <p
              className="text-sm italic text-muted-foreground"
              data-testid="coord-notifications-pending"
            >
              Notifications are not available yet.
            </p>
          ) : rows.length > 0 ? (
            <div className="space-y-1.5">
              {rows.map((n) => (
                <NotificationRow
                  key={n.notification_id}
                  notification={n}
                  expanded={expanded === n.notification_id}
                  onToggle={() =>
                    setExpanded((cur) =>
                      cur === n.notification_id ? null : n.notification_id
                    )
                  }
                  onMarkRead={() =>
                    markRead({ notification_ids: [n.notification_id] })
                  }
                  markPending={marking === n.notification_id}
                />
              ))}
              {nextCursor && (
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
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {unreadOnly
                ? "Nothing unread."
                : "No notifications matching filters."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
