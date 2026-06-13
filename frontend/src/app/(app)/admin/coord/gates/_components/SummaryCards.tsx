"use client";

/**
 * SummaryCards — at-a-glance counts for the gates & rollout dashboard.
 *
 * Open / cleared-today / failed / stale / snoozed / muted gate counts, plus
 * a rollout summary (live/shadow/dry_run auto-merge repo counts).
 */

import { Card, CardContent } from "@/components/ui/card";
import type {
  DevOverview,
  GateOverviewRow,
} from "@/services/admin-dev-service";

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

/** A verdict is "failed" when it is neither passing nor cleared/pending. */
function isFailed(verdict: string): boolean {
  const v = verdict.toLowerCase();
  return v === "fail" || v === "failed" || v === "error" || v === "veto";
}

/** A gate is "open" while it has not yet cleared. */
function isOpen(g: GateOverviewRow): boolean {
  return g.cleared_at === null || g.cleared_at === undefined;
}

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
  const gates = overview.gates;

  const open = gates.filter(isOpen).length;
  const clearedToday = gates.filter((g) => isToday(g.cleared_at)).length;
  const failed = gates.filter((g) => isFailed(g.verdict)).length;
  const stale = gates.filter((g) => g.stale).length;
  const snoozed = gates.filter((g) => g.snoozed_until !== null).length;
  const muted = gates.filter((g) => g.muted).length;

  const am = overview.rollouts.auto_merge;

  return (
    <div
      className="space-y-3"
      data-testid="gates-summary-cards"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatCard label="Open" value={open} testId="summary-open" />
        <StatCard
          label="Cleared today"
          value={clearedToday}
          testId="summary-cleared-today"
          tone="success"
        />
        <StatCard
          label="Failed"
          value={failed}
          testId="summary-failed"
          tone="destructive"
        />
        <StatCard
          label="Stale"
          value={stale}
          testId="summary-stale"
          tone="warning"
        />
        <StatCard
          label="Snoozed"
          value={snoozed}
          testId="summary-snoozed"
          tone="muted"
        />
        <StatCard
          label="Muted"
          value={muted}
          testId="summary-muted"
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
