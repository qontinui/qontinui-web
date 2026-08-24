"use client";

/**
 * /admin/coord/alerts — the `coord.alerts` rollup, rebuilt to the fleet page's
 * conventions.
 *
 * Plan `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`. What changed
 * and why (§ MEASURED 2026-08-14, 1643 unresolved rows against a 500-row
 * window):
 *
 *  - **One row per alert, ONE plain-language status** (`alertStatus.ts`), with
 *    why / what to do / links behind the click. The previous page rendered a
 *    field dump whose first column was the `alert_key` — a dedup identity, and
 *    UUID-laden.
 *  - **The unresolved-critical count comes from the API's `total_count`**,
 *    never `alerts.length`. `alerts.length` is exactly the bug that made the
 *    nav badge read a constant 500 against a 1643-row corpus, and a `count`
 *    equal to the RETURNED length is what hid the truncation from three
 *    sessions.
 *  - **The kind filter is served by the API.** The old `KINDS` list was
 *    hardcoded to `claim/conflict/stale_wip/health` and matched almost nothing
 *    live (the corpus is `stale_primary_tree`, `stale_wip`, `git_inv-2`,
 *    `worktree_unjunctioned`, `worktree_disk_danger`, `red_main`, `pr_merge_*`,
 *    `auth_client_aud_active_negation`, …). A hardcoded vocabulary rots every
 *    time a watcher is added.
 *  - **Both filters are multi-select**, because both are repeatable on the
 *    API: the proxy declares `severity` / `kind` as `list[str]` and forwards
 *    them as repeated query keys (`?kind=stale_wip&kind=red_main`) so coord
 *    filters in SQL. The first cut of this page shipped a single-select
 *    `<Select>` in front of them, which left the multi-valued half of the
 *    endpoint unreachable — "warning AND critical", or "the two kinds this
 *    outage spans", could not be asked at all.
 *  - **Keyset paging** (`limit` + opaque `cursor` → `next_cursor`).
 *
 * DEGRADATION. The coord half of the plan may not have deployed. Coord's query
 * extractor silently accepts unknown params, so an un-upgraded coord answers
 * the same request with the OLD shape: no `total_count`, no `next_cursor`, no
 * `kinds`, and 500 rows regardless of `limit`. A missing `total_count` is
 * therefore UNKNOWN, not truth — the count renders with a `≥` prefix off the
 * rows in hand, and never silently as the real number.
 *
 * The kind filter degrades the same way, and its trap is subtler: with no
 * served vocabulary the options come from the rows, and the rows are already
 * filtered by the selection. Derived per-response they would collapse to the
 * one selected kind and a second could never be added, so the fallback
 * ACCUMULATES every kind ever seen (`seenKinds`) instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Filter, RefreshCw } from "lucide-react";
import { CollapsiblePanel, FilterChips, RecordList } from "@/components/console";
import { AlertRow } from "@/components/admin/coord/AlertRow";
import {
  alertSubject,
  type CoordAlertRow,
} from "@/components/admin/coord/alertStatus";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;
/** One screenful of rows. Coord's hard max is 1000; 100 is its default. */
const PAGE_SIZE = 100;

const SEVERITIES = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
];

/** Coord's `kind` values are snake_case machine names — title them for the menu. */
function kindLabel(kind: string): string {
  return kind.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Toggle `value` in a selection, preserving the array identity when nothing
 * changes is NOT a concern here — every call is a user action.
 *
 * Returned SORTED so the same selection always produces the same query string:
 * `query` is a `useCallback` keyed on these arrays, and two orderings of the
 * same filter would otherwise be two different requests.
 */
function toggle(selection: string[], value: string): string[] {
  return selection.includes(value)
    ? selection.filter((v) => v !== value)
    : [...selection, value].sort();
}

interface AlertsResponse {
  alerts?: CoordAlertRow[];
  /** Rows RETURNED — equal to `alerts.length`, so never a truncation signal. */
  count?: number;
  /** Rows MATCHING the filter, unpaged. Absent on an un-upgraded coord. */
  total_count?: number;
  /** Opaque keyset cursor for the next page; absent/null on the last page. */
  next_cursor?: string | null;
  /** The distinct kind vocabulary, served so the filter cannot rot. */
  kinds?: Array<string | { kind?: string }>;
}

/** Normalize the served kind vocabulary; tolerates strings or `{kind}` rows. */
function readKinds(body: AlertsResponse | null): string[] {
  const raw = body?.kinds;
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const k of raw) {
    const v = typeof k === "string" ? k : k?.kind;
    if (typeof v === "string" && v.trim() !== "") out.add(v.trim());
  }
  return [...out].sort();
}

/** `{alerts:[…]}` and a bare list are both accepted (two coord vintages). */
function readBody(body: unknown): AlertsResponse {
  if (Array.isArray(body)) return { alerts: body as CoordAlertRow[] };
  return (body ?? {}) as AlertsResponse;
}

/**
 * Poll `fn` on the standard cadence, SKIPPING ticks while the tab is hidden
 * and catching up the moment it becomes visible again.
 *
 * This page arms three pollers (rows, critical total, and the nav badge on
 * top). Left ungated they bill a request each per interval per open tab
 * forever, including tabs nobody has looked at since yesterday — and an alert
 * rollup nobody is looking at is not worth a round trip. The initial fetch is
 * the CALLER's job and always runs, so a tab that mounts hidden still has data
 * when it is revealed.
 */
function usePoll(fn: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const visible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const tick = () => {
      if (visible()) fn();
    };
    const onVisibilityChange = () => {
      if (visible()) fn();
    };
    const id = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fn, enabled]);
}

/**
 * The hoisted unresolved-critical count.
 *
 * A SEPARATE `limit=1` read, because the page's own `total_count` is
 * filter-applied: with the severity filter on "warning" the page total says
 * nothing about criticals, and the point of hoisting the number is that a red
 * state never hides behind a filter OR behind a collapse.
 *
 * `known: false` means the deployed coord did not serve `total_count`. The
 * caller renders `≥N` — a LOWER BOUND, never the truncated length passed off
 * as the truth.
 */
function useCriticalTotal(): {
  value: number;
  known: boolean;
  loaded: boolean;
} {
  const [state, setState] = useState({
    value: 0,
    known: false,
    loaded: false,
  });

  const refresh = useCallback(async () => {
    try {
      const body = readBody(
        await httpClient.get<unknown>(
          `${API}/alerts?include_resolved=false&severity=critical&limit=1`
        )
      );
      if (typeof body.total_count === "number") {
        setState({ value: body.total_count, known: true, loaded: true });
      } else {
        // DEGRADED. An un-upgraded coord reads only `include_resolved` and
        // `source`, so it dropped BOTH `severity` and `limit` and answered
        // with its unfiltered, mixed-severity, 500-row window. Its length is
        // not a lower bound on criticals — a tenant with 20 criticals and 1600
        // warnings would render "≥500 critical" and paint red on a number the
        // query never established. That is the very "count a truncated sample,
        // label it as the thing you filtered for" bug this page exists to
        // kill, so reapply the filter here: the count is then a genuine floor
        // (criticals sort first, so the window holds every critical it can).
        setState({
          value: (body.alerts ?? []).filter(
            (a) => (a.severity ?? "").toLowerCase() === "critical"
          ).length,
          known: false,
          loaded: true,
        });
      }
    } catch {
      // Best-effort: a failed poll keeps the last known number rather than
      // flashing a zero, which would read as "nothing is wrong".
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  usePoll(refresh, true);

  return state;
}

export default function CoordAlertsPage() {
  // Both filters are MULTI-select and both ride the wire as REPEATED query
  // keys (`?kind=stale_wip&kind=red_main`) — the shape the proxy declares and
  // coord parses. An empty array is "no filter", never `?kind=`: the proxy
  // drops blanks precisely because an explicitly-empty param asks coord for
  // the rows whose kind is the empty string.
  const [severities, setSeverities] = useState<string[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [includeResolved, setIncludeResolved] = useState(false);

  /** Accumulated pages. Index 0 is the live page the poller refreshes. */
  const [pages, setPages] = useState<CoordAlertRow[][]>([]);
  const [head, setHead] = useState<AlertsResponse | null>(null);
  const [tailCursor, setTailCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const criticalTotal = useCriticalTotal();

  /**
   * Generation counter for in-flight reads. Bumped by EVERY action that
   * changes what the list should show — a filter change, a manual refresh, a
   * "load more" — and re-checked before each commit, so a response that
   * belongs to a superseded query is dropped instead of painted.
   *
   * Two live races it closes:
   *  - `loadMore` vs the page-1 poller. While one page is loaded the poller is
   *    armed; if its `fetchFirstPage` resolved AFTER `loadMore` appended page
   *    2, `setPages([page1])` discarded page 2 and rewound the cursor. The
   *    button looked broken, and the window recurred every 10s.
   *  - two rapid filter changes. Both fetches fly; the SLOWER one committed
   *    last, so the rows described one filter while `total_count` described
   *    another.
   */
  const generation = useRef(0);

  const query = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams();
      qs.set("include_resolved", String(includeResolved));
      qs.set("limit", String(PAGE_SIZE));
      // `append`, not `set` — a repeated key is the whole point.
      for (const s of severities) qs.append("severity", s);
      for (const k of selectedKinds) qs.append("kind", k);
      if (cursor) qs.set("cursor", cursor);
      return `${API}/alerts?${qs.toString()}`;
    },
    // Array identity is stable between renders (`useState` hands back the same
    // array until a toggle replaces it), so this does not re-fire per render.
    [severities, selectedKinds, includeResolved]
  );

  /** Refetch the FIRST page, discarding anything the user had paged into. */
  const fetchFirstPage = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const body = readBody(await httpClient.get<unknown>(query(null)));
      if (mine !== generation.current) return;
      setHead(body);
      setPages([body.alerts ?? []]);
      setTailCursor(body.next_cursor ?? null);
      setError(null);
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [query]);

  const loadMore = useCallback(async () => {
    if (!tailCursor) return;
    // Bumping BEFORE the request is what makes a poller response that is
    // already in flight lose to this one.
    const mine = ++generation.current;
    setPaging(true);
    try {
      const body = readBody(await httpClient.get<unknown>(query(tailCursor)));
      if (mine !== generation.current) return;
      setPages((prev) => [...prev, body.alerts ?? []]);
      setTailCursor(body.next_cursor ?? null);
      setError(null);
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === generation.current) setPaging(false);
    }
  }, [query, tailCursor]);

  // Filters reset the accumulation; the poller only ever refreshes page 1.
  useEffect(() => {
    setLoading(true);
    setPages([]);
    fetchFirstPage();
  }, [fetchFirstPage]);

  // Polling is SUSPENDED once the operator has paged past the first screen:
  // refreshing page 1 under them would silently drop the pages they walked to.
  const paged = pages.length > 1;
  usePoll(fetchFirstPage, !paged);

  const alerts = useMemo(() => pages.flat(), [pages]);

  const servedKinds = useMemo(() => readKinds(head), [head]);
  const kindsAreServed = servedKinds.length > 0;

  /**
   * Every kind seen in a ROW so far, accumulated across responses.
   *
   * Only consulted on the degraded path (coord served no `kinds`), and it has
   * to accumulate rather than read the current window because on that path the
   * window is ALREADY filtered by the selection. Deriving the options from it
   * directly would collapse the chip row to the one kind currently filtered on
   * the moment you picked it, and a second kind could never be added — the
   * multi-select would be a capability with no way to reach it, which is the
   * exact shape this page exists to stop shipping.
   *
   * A ref, not state: it only ever feeds a `useMemo` that already re-runs when
   * `alerts` changes, so making it state would add a render for no new paint.
   */
  const seenKinds = useRef<Set<string>>(new Set());

  // The kind vocabulary: served by the API when it can be, otherwise every
  // kind observed so far. The derived list is PARTIAL by construction (it can
  // only name kinds that have appeared in some window) — labelled as such
  // rather than presented as the vocabulary.
  //
  // The SELECTED kinds are unioned into BOTH branches. Coord's served list is
  // "kinds with a live row", so resolving the last row of a kind currently
  // filtered on would drop its chip from the row while the filter is still
  // applied — a filter doing something with no control showing it.
  const kinds = useMemo(() => {
    for (const a of alerts) if (a.kind) seenKinds.current.add(a.kind);
    const seen = new Set<string>(servedKinds);
    if (seen.size === 0) {
      for (const k of seenKinds.current) seen.add(k);
    }
    for (const k of selectedKinds) seen.add(k);
    return [...seen].sort();
  }, [servedKinds, alerts, selectedKinds]);

  const headTotal = head?.total_count;
  const totalKnown = typeof headTotal === "number";
  const matchTotal = typeof headTotal === "number" ? headTotal : alerts.length;
  /** True once a list read has COMMITTED — `head` is null until then. */
  const firstAnswerIn = head !== null;

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-alerts-page">
      <CollapsiblePanel
        data-testid="coord-alerts-panel"
        storageKey="coord:alerts"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Alerts"
        // Hoisted so a red state never hides behind the collapse, and sourced
        // from `total_count` so it can never read a truncated 500.
        summary={
          <Badge
            variant="outline"
            className={
              criticalTotal.value > 0
                ? "bg-red-500/15 text-red-200 border-red-500/35"
                : undefined
            }
            data-testid="coord-alerts-critical-count"
            data-total-known={criticalTotal.known}
            title={
              criticalTotal.known
                ? "unresolved critical alerts (coord's unpaged total)"
                : "this coord build does not report a total — at LEAST this many, " +
                  "counted from the truncated window"
            }
          >
            {criticalTotal.loaded ? (
              <>
                {criticalTotal.known ? "" : "≥"}
                {criticalTotal.value} critical
              </>
            ) : (
              // Not "0 critical" — a count nobody has answered yet is UNKNOWN,
              // and rendering it as zero reads as "nothing is wrong".
              "… critical"
            )}
          </Badge>
        }
        headerActions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchFirstPage}
            data-testid="coord-alerts-refresh"
            // Icon-only: without this the button has no accessible name at all.
            aria-label="Refresh alerts"
            title="Refresh alerts (returns to the first page)"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
          </Button>
        }
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <FilterChips
            label="severity"
            testIdPrefix="coord-alerts-severity-filter"
            options={SEVERITIES}
            selected={severities}
            onToggle={(v) => setSeverities((prev) => toggle(prev, v))}
            onClear={() => setSeverities([])}
          />
          <FilterChips
            label="kind"
            testIdPrefix="coord-alerts-kind-filter"
            options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))}
            // The vocabulary is coord's, not ours: 43 distinct live kinds on
            // 2026-08-24 (qontinui-web#1063) against the ~10 this page was
            // written for. Uncapped that is four or five wrapped rows of chips
            // above the records — §5's density budget spent on a control.
            // Selected kinds are exempt from the cap.
            maxVisible={12}
            selected={selectedKinds}
            onToggle={(v) => setSelectedKinds((prev) => toggle(prev, v))}
            onClear={() => setSelectedKinds([])}
            // The vocabulary is served by the API when it can be; when it is
            // not, the chips are only the kinds inside the window already
            // loaded. Say which — a partial list presented as the vocabulary
            // is the `silent-empty-is-unknown` mistake in menu form.
            allLabel={kindsAreServed ? "all" : "all (list partial)"}
            title={
              kindsAreServed
                ? "kinds served by the API"
                : "this coord build does not serve the kind list — showing only " +
                  "the kinds present in the rows loaded so far"
            }
          />
          <div className="flex items-center gap-1.5 ml-2">
            <Switch
              id="include-resolved"
              checked={includeResolved}
              onCheckedChange={setIncludeResolved}
              data-testid="coord-alerts-include-resolved"
            />
            <label
              htmlFor="include-resolved"
              className="text-xs text-muted-foreground normal-case tracking-normal"
            >
              include resolved
            </label>
          </div>
          <span
            className="text-xs text-muted-foreground normal-case tracking-normal"
            data-testid="coord-alerts-match-count"
            data-total-known={totalKnown}
          >
            {/* Nothing has answered yet — "showing 0 of ≥0" asserts an empty
                corpus on no evidence, the same reading the critical badge
                above already refuses to make. */}
            {firstAnswerIn ? (
              <>
                showing {alerts.length} of {totalKnown ? "" : "≥"}
                {matchTotal}
              </>
            ) : (
              "counting…"
            )}
          </span>
        </div>

        {error && (
          <p className="text-sm text-destructive normal-case tracking-normal">
            Failed to load: {error}
          </p>
        )}

        {/* R2/R5 — `<RecordList>` owns the skeleton, the empty state and the
            one-open-at-a-time expansion. The `itemKey` is the row's own
            identity, NEVER its array position: a row resolving out of page 1
            would otherwise re-key every row after it and collapse whichever
            panel the operator had opened. `id` (the PK) first, `alert_key`
            (the dedup identity) when coord omits it, and — only when a payload
            carries neither — the subject WITH the index appended, because a
            subject alone is not unique and `<RecordList>` expands on key
            equality, so two rows sharing one would open together. */}
        <RecordList
          items={alerts}
          itemKey={(a, i) =>
            String(a.id ?? a.alert_key ?? `${alertSubject(a)}#${i}`)
          }
          loaded={!(loading && pages.length === 0)}
          skeletonRows={6}
          className="space-y-1.5"
          empty={
            error === null ? (
              // Gated on `error`: a failed first load leaves `pages` empty, and
              // asserting "nothing matched" on a request that never answered is
              // exactly the empty-is-not-unknown mistake this page is about. The
              // failure message above is the honest rendering.
              <p className="text-sm text-muted-foreground italic normal-case tracking-normal">
                No alerts matching filters.
              </p>
            ) : null
          }
          renderRow={(a, ctx) => (
            <AlertRow
              alert={a}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
        />

        {(tailCursor || paged) && (
          <div className="flex items-center gap-3">
            {tailCursor && (
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={paging}
                data-testid="coord-alerts-load-more"
              >
                {paging ? "Loading…" : "Load more"}
              </Button>
            )}
            {paged && (
              // Hoisted OUT of the `tailCursor` guard: on the last page the
              // Load-more button is gone, and nesting the notice inside it
              // meant polling silently stopped with nothing on screen saying
              // so — precisely when the operator is deepest in the list.
              <span
                className="text-xs text-muted-foreground normal-case tracking-normal"
                data-testid="coord-alerts-poll-paused"
              >
                live refresh paused while paging — use refresh to return to the
                first page
              </span>
            )}
          </div>
        )}
      </CollapsiblePanel>
    </div>
  );
}
