"use client";

/**
 * SummaryCards — at-a-glance counts for the gates & rollout dashboard.
 *
 * Open / cleared-today / failed / stale / snoozed / muted / archived gate
 * counts, plus a rollout summary (live/shadow/dry_run auto-merge repo counts).
 */

import { Card, CardContent } from "@/components/ui/card";
import type { DevOverview } from "@/services/admin-dev-service";

interface StatCardProps {
  label: string;
  value: number;
  testId: string;
  tone?: "default" | "success" | "warning" | "destructive" | "muted";
}

function StatCard({ label, value, testId, tone = "default" }: StatCardProps) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div
          className={`text-2xl font-semibold tabular-nums ${toneClass}`}
          data-testid={`${testId}-value`}
        >
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ overview }: { overview: DevOverview }) {
  // Use the tenant-wide `counts` (computed across ALL gates), NOT the returned
  // page — the page is OPEN-first and capped, so page-derived totals would
  // undercount cleared/failed once a tenant has more gates than the cap.
  const c = overview.counts;
  const am = overview.rollouts.auto_merge;

  return (
    <div
      className="space-y-3"
      data-testid="gates-summary-cards"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 sm:gap-3">
        <StatCard label="Open" value={c.open} testId="summary-open" />
        <StatCard
          label="Cleared today"
          value={c.cleared_today}
          testId="summary-cleared-today"
          tone="success"
        />
        <StatCard
          label="Failed"
          value={c.failed}
          testId="summary-failed"
          tone="destructive"
        />
        <StatCard
          label="Stale"
          value={c.stale}
          testId="summary-stale"
          tone="warning"
        />
        <StatCard
          label="Snoozed"
          value={c.snoozed}
          testId="summary-snoozed"
          tone="muted"
        />
        <StatCard
          label="Muted"
          value={c.muted}
          testId="summary-muted"
          tone="muted"
        />
        <StatCard
          label="Archived"
          value={c.archived}
          testId="summary-archived"
          tone="muted"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="summary-rollout">
        <StatCard
          label="Auto-merge: live"
          value={am.live.length}
          testId="summary-rollout-live"
          tone="success"
        />
        <StatCard
          label="Auto-merge: shadow"
          value={am.shadow.length}
          testId="summary-rollout-shadow"
          tone="warning"
        />
        <StatCard
          label="Auto-merge: dry-run"
          value={am.dry_run.length}
          testId="summary-rollout-dry-run"
          tone="muted"
        />
      </div>
    </div>
  );
}
