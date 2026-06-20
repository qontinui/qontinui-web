"use client";

/**
 * /admin/coord/gates — superuser "gates & rollout" dashboard.
 *
 * Lives inside the coord operator console (`CoordLayout`), which already
 * enforces the superuser gate and renders the console header + CoordNav.
 * This page therefore does NOT re-implement auth or a top header — it
 * renders a sub-header + summary cards + gates table + rollout panel within
 * the layout's `<main>`.
 *
 * Data: `adminDevService.getOverview()` → web backend
 * `GET /api/v1/admin-dev/overview` → coord `GET /coord/dev-overview`. The
 * frontend never talks to coord directly.
 *
 * Auto-refresh: opt-in, default ON, ~45s interval, with a "updated Xs ago"
 * stamp that ticks every second and a pause/resume toggle. Polling cleans up
 * its interval on unmount and never overlaps an in-flight request (an
 * in-flight ref gates re-entry). Auto-poll reads through the backend's ~30s
 * cache; manual Refresh passes `refresh:true` (`?refresh=1`) to bypass it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Archive, Gauge, Pause, Play, RefreshCw } from "lucide-react";
import {
  adminDevService,
  type DevOverview,
} from "@/services/admin-dev-service";
import { SummaryCards } from "./_components/SummaryCards";
import { GatesTable } from "./_components/GatesTable";
import { RolloutPanel } from "./_components/RolloutPanel";

// Auto-refresh cadence. Slightly above the backend's ~30s cache TTL so a
// poll usually lands a fresh server-side eval rather than a cache hit.
const AUTO_REFRESH_MS = 45_000;

function generatedAtLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function relativeAgoLabel(at: number | null, now: number): string {
  if (at === null) return "";
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 5) return "updated just now";
  if (secs < 60) return `updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return rem ? `updated ${mins}m ${rem}s ago` : `updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `updated ${hrs}h ${mins % 60}m ago`;
}

export default function CoordGatesPage() {
  const [overview, setOverview] = useState<DevOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // When on, the gate list page includes reaper-archived gates (live-only by
  // default). The `counts.archived` tile is always shown regardless.
  const [includeArchived, setIncludeArchived] = useState(false);

  // Wall-clock of the last successful load, and a 1s ticker that drives the
  // "updated Xs ago" label without re-fetching.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Guards against overlapping fetches (a slow request + a fired interval).
  const inFlight = useRef(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (isRefresh) setRefreshing(true);
    try {
      const data = await adminDevService.getOverview({
        refresh: isRefresh,
        includeArchived,
      });
      setOverview(data);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }, [includeArchived]);

  // Initial load.
  useEffect(() => {
    load(false);
  }, [load]);

  // Auto-refresh interval (cleaned up on unmount / toggle off).
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      load(false);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // 1s ticker for the relative "updated Xs ago" stamp.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-gates-page">
      {/* ---- Sub-header (layout owns the top console header) ---- */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Gates &amp; rollout</h2>
            <p className="text-xs text-muted-foreground">
              Gate progress, verdicts, continuation state, and the auto-merge /
              feature-enablement rollout tiers.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {updatedAt !== null && (
            <span
              className="text-xs text-muted-foreground hidden sm:inline tabular-nums"
              data-testid="gates-updated-ago"
              title={
                overview
                  ? `coord generated_at ${generatedAtLabel(overview.generated_at)}`
                  : undefined
              }
            >
              {relativeAgoLabel(updatedAt, now)}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIncludeArchived((v) => !v)}
            data-testid="gates-archived-toggle"
            aria-pressed={includeArchived}
            title={
              includeArchived
                ? "Showing archived gates — click to hide"
                : "Show reaper-archived gates"
            }
          >
            <Archive className="h-3.5 w-3.5 mr-1" />
            {includeArchived ? "Archived: on" : "Archived"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            data-testid="gates-autorefresh-toggle"
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
            data-testid="gates-refresh"
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
          data-testid="gates-error"
        >
          Failed to load dev overview: {error}
        </div>
      )}

      {/* ---- coord-unavailable banner (proxy degraded to an empty envelope) ---- */}
      {overview?.coord_error && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          data-testid="gates-coord-unavailable"
        >
          coord is currently unavailable ({overview.coord_error}) — showing no
          gates or rollout state. Retry with Refresh.
        </div>
      )}

      {/* ---- Loading skeleton (first load) ---- */}
      {loading && !overview ? (
        <div className="space-y-4" data-testid="gates-loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : overview ? (
        <>
          <SummaryCards overview={overview} />

          {overview.gates.length === 0 ? (
            <div
              className="rounded-md border border-border px-3 py-8 text-center text-sm text-muted-foreground italic"
              data-testid="gates-empty"
            >
              No gates registered.
            </div>
          ) : (
            <GatesTable gates={overview.gates} />
          )}

          <RolloutPanel rollouts={overview.rollouts} />
        </>
      ) : (
        !error && (
          <div
            className="text-center text-sm text-muted-foreground italic py-8"
            data-testid="gates-empty-overview"
          >
            No overview data available.
          </div>
        )
      )}
    </div>
  );
}
