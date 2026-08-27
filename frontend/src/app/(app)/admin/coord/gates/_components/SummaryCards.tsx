"use client";

/**
 * SummaryCards — at-a-glance counts for the gates & rollout dashboard.
 *
 * Open / cleared-today / failed / stale / snoozed / muted / archived gate
 * counts, plus a rollout summary (enabled/disabled auto-merge repo counts).
 *
 * ## Console style (Phase 3 Wave 4) — R1, and `StatCluster`'s first consumer
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1
 * extracted `<StatCluster>` FROM this file's `StatCard` and then shipped it
 * with no consumer at all, saying so in its own doc comment: *"Not yet
 * consumed: `/gates` moves onto it in Phase 3 Wave 4, which is where its
 * `data-testid`s are ported."* This is that move.
 *
 * What it buys: ten `<Card>`s with `text-2xl` numbers cost ~230px of vertical
 * space above the fold to carry ten integers, on a page whose whole point is
 * the gate rows underneath. The same ten integers render as two wrapping lines
 * of mono badges, at the hue rules the `<HealthStrip>` badge cluster uses, so
 * the two openings are one visual vocabulary.
 *
 * **The tones changed, and that is R3, not taste.** `Stale` and
 * `Would-be-reaped` were `warning` amber and `Auto-merge: disabled` was too.
 * Amber promises *something else will clear this*, and none of the three has a
 * clearer: a stale gate stays stale until a human looks, a shadow would-reap
 * is an audit line, and a disabled repo is disabled because somebody disabled
 * it. `Stale` and `Failed` — the two counts that genuinely name rows needing a
 * human — take the `attention` tone; everything else is calm or muted.
 */

import type { DevOverview } from "@/services/admin-dev-service";
import { StatCluster, type Stat } from "@/components/console";

export function SummaryCards({ overview }: { overview: DevOverview }) {
  // Use the tenant-wide `counts` (computed across ALL gates), NOT the returned
  // page — the page is OPEN-first and capped, so page-derived totals would
  // undercount cleared/failed once a tenant has more gates than the cap.
  const c = overview.counts;
  const am = overview.rollouts.auto_merge;

  const gateStats: Stat[] = [
    {
      key: "open",
      label: "open ",
      value: c.open,
      "data-testid": "summary-open-value",
    },
    {
      key: "cleared-today",
      label: "cleared today ",
      value: c.cleared_today,
      tone: "success",
      "data-testid": "summary-cleared-today-value",
    },
    {
      key: "failed",
      label: "failed ",
      value: c.failed,
      // The R3 red, and it means the same here as on a row: a human decides
      // what happens to a failed gate.
      tone: c.failed > 0 ? "attention" : "muted",
      "data-testid": "summary-failed-value",
    },
    {
      key: "stale",
      label: "stale ",
      value: c.stale,
      tone: c.stale > 0 ? "attention" : "muted",
      title:
        "Open gates coord's sweep has not re-evaluated recently. Nothing clears these but a human looking — see gateStatus.ts.",
      "data-testid": "summary-stale-value",
    },
    {
      key: "snoozed",
      label: "snoozed ",
      value: c.snoozed,
      tone: "muted",
      "data-testid": "summary-snoozed-value",
    },
    {
      key: "muted",
      label: "muted ",
      value: c.muted,
      tone: "muted",
      "data-testid": "summary-muted-value",
    },
    {
      key: "archived",
      label: "archived ",
      value: c.archived,
      tone: "muted",
      "data-testid": "summary-archived-value",
    },
    {
      key: "would-reap",
      label: "would-reap (shadow) ",
      value: c.would_reap,
      // An audit line from a SHADOW cycle: it reaps nothing and blocks nobody.
      tone: "muted",
      title:
        "Tier-4 SHADOW audit: gates the reaper WOULD reap if it were armed. It is not armed, so this count reaps nothing.",
      "data-testid": "summary-would-reap-value",
    },
  ];

  const rolloutStats: Stat[] = [
    {
      key: "rollout-enabled",
      label: "auto-merge on ",
      value: (am.enabled ?? []).length,
      tone: "success",
      "data-testid": "summary-rollout-enabled-value",
    },
    {
      key: "rollout-disabled",
      label: "auto-merge off ",
      value: (am.disabled ?? []).length,
      // Muted, not amber: a repo is disabled because somebody disabled it.
      tone: "muted",
      "data-testid": "summary-rollout-disabled-value",
    },
  ];

  return (
    <div className="space-y-2" data-testid="gates-summary-cards">
      <StatCluster stats={gateStats} />
      <StatCluster stats={rolloutStats} data-testid="summary-rollout" />
    </div>
  );
}
