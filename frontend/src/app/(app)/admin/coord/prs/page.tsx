"use client";

/**
 * /admin/coord/prs — superuser "open PRs" dashboard.
 *
 * Lists every open PR fleet-wide with its CI/merge status and a colored
 * blocking-reason badge answering "why isn't this merging." Lives inside the
 * coord operator console (`CoordLayout`), which already enforces the superuser
 * gate and renders the console header + CoordNav. This page therefore does NOT
 * re-implement auth or a top header — it renders a sub-header + summary line +
 * PRs table within the layout's `<main>`.
 *
 * Data: `adminDevService.getPrs()` → web backend `GET /api/v1/admin-dev/prs`
 * → coord `GET /pr-merge/prs`. The frontend never talks to coord directly.
 * coord owns `merge_status` + `blocking_summary` (pure passthrough).
 *
 * Auto-refresh: opt-in, default ON, ~45s interval, with a "updated Xs ago"
 * stamp that ticks every second and a pause/resume toggle. Polling cleans up
 * its interval on unmount and never overlaps an in-flight request (an in-flight
 * ref gates re-entry). Manual Refresh passes `refresh:true` (`?refresh=1`).
 *
 * Tabs: "Open" (default — open + draft PRs, unchanged) vs "Recently merged
 * (24h)" (calls `getPrs({ includeMerged: 24 })`, surfacing a Deploy badge
 * column answering "has my PR deployed yet?"). Switching tabs re-fetches; the
 * auto-refresh / "updated Xs ago" machinery is shared across both.
 *
 * Coord-down resilience: the web proxy converts a coord outage into a 200
 * `{prs: [], coord_error}` envelope. Instead of blanking to "No PRs", the page
 * RETAINS the last-good rows for the SAME tab and shows a subtle "showing last
 * data" reconnecting hint over them (the hard banner is reserved for cold-start
 * outages with nothing to retain), polling faster (~5s) until coord recovers.
 * Both coord banners are gated on `!loading`: the skeleton owns the body during
 * any load/tab-switch window, so neither may describe data that isn't on screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { GitPullRequest, Pause, Play, RefreshCw } from "lucide-react";
import {
  adminDevService,
  type PrListResponse,
} from "@/services/admin-dev-service";
import { PrsTable, isMergeStateRecalibrating } from "./_components/PrsTable";
import { DeployStatusStrip } from "./_components/DeployStatusStrip";

// Auto-refresh cadence — matches the gates dashboard.
const AUTO_REFRESH_MS = 45_000;
// Faster cadence while coord is unavailable (degraded `coord_error` envelope):
// poll every ~5s so the page recovers promptly the moment coord is back, then
// drop back to AUTO_REFRESH_MS on a healthy response. Matches the gates page.
const RECONNECT_REFRESH_MS = 5_000;

// When any row is "Recalibrating" (GitHub's UNKNOWN merge state), poll on this
// much tighter cadence with a FORCED refresh (`?refresh=1`) so coord re-reads
// GitHub and the state settles ASAP — but bounded, so a genuinely stuck
// mergeability calc can't turn into an infinite hammer on the GitHub API.
const RECALIBRATE_POLL_MS = 8_000;
const RECALIBRATE_MAX_TRIES = 6;

// "Recently merged" lookback window (hours) → coord `include_merged`.
const MERGED_LOOKBACK_HOURS = 24;

type PrTab = "open" | "merged";

function relativeAgoLabel(at: number | null, now: number): string {
  if (at === null) return "";
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 5) return "updated just now";
  if (secs < 60) return `updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60)
    return rem ? `updated ${mins}m ${rem}s ago` : `updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `updated ${hrs}h ${mins % 60}m ago`;
}

export default function CoordPrsPage() {
  const [tab, setTab] = useState<PrTab>("open");
  const [data, setData] = useState<PrListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Coord-side degradation from the latest envelope (`coord_error`). Non-null
  // while coord is unavailable; drives the banner split + fast reconnect poll.
  // Tracked separately from `data` because a RETAINED `data` is a healthy
  // envelope with no coord_error on it.
  const [coordError, setCoordError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Wall-clock of the last successful load, and a 1s ticker that drives the
  // "updated Xs ago" label without re-fetching.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Guards against overlapping fetches (a slow request + a fired interval).
  const inFlight = useRef(false);

  // Synchronous mirror of the last APPLIED response (+ the tab it was fetched
  // for). `load` is memoized on `[tab]`, so reading the `data` state there
  // would hit a stale closure; the `inFlight` guard means fetches never
  // overlap, so this ref always reads fresh. The tab is recorded so a degraded
  // fetch for a DIFFERENT tab never retains the other tab's rows.
  const dataRef = useRef<{ tab: PrTab; resp: PrListResponse } | null>(null);

  // Bounded-retry counter for the fast "recalibration" poll. Reset to 0 the
  // moment no row is recalibrating (a fresh UNKNOWN episode gets its own budget).
  const recalibrateTries = useRef(0);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (isRefresh) setRefreshing(true);
      try {
        const resp = await adminDevService.getPrs({
          ...(isRefresh ? { refresh: true } : {}),
          ...(tab === "merged"
            ? { includeMerged: MERGED_LOOKBACK_HOURS }
            : {}),
        });
        setCoordError(resp.coord_error ?? null);
        // Retain the last-good rows when coord degrades to an empty
        // `coord_error` envelope, so a transient outage never blanks the page
        // to "No PRs". Only retain for the SAME tab and only when we actually
        // have rows to keep; otherwise apply the response as-is.
        const prev = dataRef.current;
        const retain =
          !!resp.coord_error &&
          prev !== null &&
          prev.tab === tab &&
          prev.resp.prs.length > 0;
        if (!retain) {
          dataRef.current = { tab, resp };
          setData(resp);
          // Only a healthy response counts as "updated" — a degraded envelope
          // carries no fresh data, so the staleness stamp keeps aging.
          if (!resp.coord_error) setUpdatedAt(Date.now());
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
        inFlight.current = false;
      }
    },
    [tab],
  );

  // Initial load + reload whenever the active tab changes. `loading` drives
  // the body skeleton so the other tab's content doesn't flash before the
  // refetch lands. `data`/`dataRef` are deliberately NOT cleared here —
  // retention across a same-tab coord outage depends on them surviving.
  useEffect(() => {
    setLoading(true);
    load(false);
  }, [load]);

  // Auto-refresh interval (cleaned up on unmount / toggle off). While coord is
  // unavailable (`coordError`), poll faster so the page recovers promptly the
  // moment coord is back; a healthy response clears the flag and the effect
  // re-runs at the normal cadence.
  useEffect(() => {
    if (!autoRefresh) return;
    const intervalMs =
      coordError !== null ? RECONNECT_REFRESH_MS : AUTO_REFRESH_MS;
    const id = setInterval(() => {
      load(false);
    }, intervalMs);
    return () => clearInterval(id);
  }, [autoRefresh, coordError, load]);

  // 1s ticker for the relative "updated Xs ago" stamp.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ---- The coord-outage banner split ----
  // Both banners share one gate: coord is degraded AND we are not mid-load.
  // The `!loading` half matters because this page's body skeleton is driven by
  // `loading` ALONE (retention needs `data` to survive a tab switch, so it
  // can't be `loading && !data` like the gates page). That makes a banner and
  // the skeleton renderable at the same time, and a banner describing data the
  // skeleton isn't showing is a lie. A same-tab auto-refresh never sets
  // `loading`, so steady-state outage retention is unaffected.
  // Which banner shows is then decided solely by whether rows are retained, so
  // exactly one can ever render — never both, never one over the skeleton.
  const coordOutageVisible = coordError !== null && !loading;
  const hasRetainedRows = data !== null && data.prs.length > 0;

  // How many visible rows are in the transient "Recalibrating" (UNKNOWN) state.
  const recalibratingCount = data
    ? data.prs.filter((p) => isMergeStateRecalibrating(p)).length
    : 0;

  // Fast forced-refresh poll while anything is recalibrating. The normal 45s
  // auto-refresh reads coord's cache (`load(false)`), which stays UNKNOWN when
  // coord itself is stale — only a forced `load(true)` (`?refresh=1`) makes
  // coord re-read GitHub and settle the state. Runs regardless of the
  // auto-refresh pause (it targets a transient, self-terminating condition) and
  // is capped at RECALIBRATE_MAX_TRIES so a genuinely stuck calc can't hammer
  // GitHub. `updatedAt` in the deps re-arms the timer after each load lands.
  useEffect(() => {
    if (recalibratingCount === 0) {
      recalibrateTries.current = 0;
      return;
    }
    if (recalibrateTries.current >= RECALIBRATE_MAX_TRIES) return;
    const id = setTimeout(() => {
      recalibrateTries.current += 1;
      load(true);
    }, RECALIBRATE_POLL_MS);
    return () => clearTimeout(id);
  }, [recalibratingCount, updatedAt, load]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-prs-page">
      {/* ---- Sub-header (layout owns the top console header) ---- */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <GitPullRequest className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Pull Requests</h2>
            <p className="text-xs text-muted-foreground">
              Every open PR fleet-wide with its CI / merge status and the
              blocking reason answering &ldquo;why isn&rsquo;t this
              merging.&rdquo;
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {updatedAt !== null && (
            <span
              className="text-xs text-muted-foreground hidden sm:inline tabular-nums"
              data-testid="prs-updated-ago"
            >
              {relativeAgoLabel(updatedAt, now)}
            </span>
          )}
          {recalibratingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs text-info"
              data-testid="prs-recalibrating"
              title={`${recalibratingCount} PR${recalibratingCount === 1 ? "" : "s"} recalibrating — forcing a GitHub re-read until the merge state settles`}
            >
              <RefreshCw className="h-3 w-3 animate-spin" />
              {recalibratingCount} recalibrating
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            data-testid="prs-autorefresh-toggle"
            aria-pressed={autoRefresh}
            title={
              autoRefresh
                ? "Auto-refresh on (~45s) — click to pause"
                : "Auto-refresh paused — click to resume"
            }
          >
            {autoRefresh ? (
              <Pause className="h-3.5 w-3.5 mr-1" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1" />
            )}
            {autoRefresh ? "Auto" : "Paused"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            data-testid="prs-refresh"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* ---- Error ---- */}
      {error && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="prs-error"
        >
          Failed to load open PRs: {error}
        </div>
      )}

      {/* ---- Reconnecting hint (coord down, last-good rows retained) ----
          A transient coord outage while we hold last-good rows for this tab:
          show a subtle hint OVER the still-rendered table and auto-recover —
          never the hard banner below. See the banner-split derivation above
          for why both are gated on not-loading. */}
      {coordOutageVisible && hasRetainedRows && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
          data-testid="prs-coord-reconnecting"
          role="status"
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>
            coord is currently unavailable ({coordError}) — showing last data (
            {relativeAgoLabel(updatedAt, now)}). Retries automatically.
          </span>
        </div>
      )}

      {/* ---- coord-unavailable banner (cold-start outage: no rows to retain) ----
          The other side of the split. Without the shared not-loading gate this
          would paint "showing no PRs. Retry with Refresh." over the skeleton —
          asserting an outage the in-flight fetch may already have disproved,
          and pointing at a Refresh button that is `disabled` while loading. */}
      {coordOutageVisible && !hasRetainedRows && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          data-testid="prs-coord-unavailable"
          role="status"
        >
          coord is currently unavailable ({coordError}) — showing no PRs. Retry
          with Refresh.
        </div>
      )}

      {/* ---- Deploy-status strip — glanceable per-surface "is prod current?" ---- */}
      <DeployStatusStrip />

      {/* ---- Open vs Recently-merged tabs ---- */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as PrTab)}>
        <TabsList data-testid="coord-prs-tabs">
          <TabsTrigger value="open" data-testid="coord-prs-tab-open">
            Open
          </TabsTrigger>
          <TabsTrigger value="merged" data-testid="coord-prs-tab-merged">
            Recently merged (24h)
          </TabsTrigger>
        </TabsList>

        {/* Both tabs share one data source (the active-tab fetch). Render the
            same body under whichever tab is active; the empty-state copy and
            the table's Deploy column adapt to `merged`. */}
        {/* `loading` (not `loading && !data`) drives the skeleton: a tab
            switch keeps the previous tab's `data` for outage retention, so the
            skeleton is what prevents its rows flashing under the new tab's
            header. Auto-refresh never sets `loading`, so it can't blank the
            table. */}
        <TabsContent value={tab} className="mt-3">
          {loading ? (
            <div className="space-y-4" data-testid="prs-loading">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : data ? (
            data.prs.length === 0 ? (
              <div
                className="rounded-md border border-border px-3 py-8 text-center text-sm text-muted-foreground italic"
                data-testid="prs-empty"
              >
                {tab === "merged"
                  ? "No PRs merged in the last 24h."
                  : "No open PRs."}
              </div>
            ) : (
              <PrsTable prs={data.prs} merged={tab === "merged"} />
            )
          ) : (
            !error && (
              <div
                className="text-center text-sm text-muted-foreground italic py-8"
                data-testid="prs-empty-overview"
              >
                No PR data available.
              </div>
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
