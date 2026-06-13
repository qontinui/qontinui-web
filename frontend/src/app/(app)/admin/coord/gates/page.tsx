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
 * frontend never talks to coord directly. Manual Refresh re-calls
 * getOverview (no auto-poll — gate/rollout state is operator-paced).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge, RefreshCw } from "lucide-react";
import {
  adminDevService,
  type DevOverview,
} from "@/services/admin-dev-service";
import { SummaryCards } from "./_components/SummaryCards";
import { GatesTable } from "./_components/GatesTable";
import { RolloutPanel } from "./_components/RolloutPanel";

function generatedAtLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function CoordGatesPage() {
  const [overview, setOverview] = useState<DevOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await adminDevService.getOverview();
      setOverview(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-gates-page">
      {/* ---- Sub-header (layout owns the top console header) ---- */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Gates &amp; rollout</h2>
            <p className="text-xs text-muted-foreground">
              Plan-gate progress, verdicts, continuation state, and the
              auto-merge / feature-enablement rollout tiers.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {overview && (
            <span
              className="text-xs text-muted-foreground hidden sm:inline"
              data-testid="gates-generated-at"
            >
              as of {generatedAtLabel(overview.generated_at)}
            </span>
          )}
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
