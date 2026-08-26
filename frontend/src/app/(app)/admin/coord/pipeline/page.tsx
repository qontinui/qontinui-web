"use client";

/**
 * /admin/coord/pipeline — the merge pipeline.
 *
 * Renamed from `/admin/coord/fleet` by plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 4, with a 308
 * from the old path in `next.config.mjs`. The tab has read `Pipeline` since
 * the 2026-07-14 redesign, and after that phase "fleet" means Dev Ops — two
 * meanings for one word in one console is exactly the predictability cost
 * `docs/console-ui-style-guide.md` exists to prevent.
 *
 * ## What this page is, after the drawer
 *
 * Everything here answers ONE question: *where is my PR and is it stuck?*
 *
 *  - `StuckPrRecoveryPanel` — the tenant's own door out of a wedged train.
 *    Renders `null` when nothing is stuck.
 *  - `MergePipeline` — the hero: health strip, filter tabs, one row per PR,
 *    with the cross-repo dependency DAG inside a row's own expansion (it
 *    already knows the repo and the PR number, so nothing is re-typed).
 *  - `CiStatusPanel` — promoted out of the deleted drawer to sit directly
 *    under the hero, because CI results are *why* PRs are stuck.
 *
 * ## What left, and where it went
 *
 * The single collapsed `System details` `CollapsiblePanel` is **deleted**.
 * `HealthSummaryCard`, `FleetOverview` and `FleetResourcesSection` are on
 * `/admin/coord/devops`; `FleetTestTargetsPanel` and `MigrationQueueTile` are
 * their own Dev Ops routes; `DevActionsTile` joined the agent-activity ledger
 * at `/admin/coord/agents`; `GatesPanel` is gone in favour of
 * `/admin/coord/gates`, which already held a strict superset of its actions;
 * `LandedFeaturesPanel` is deleted outright.
 *
 * ## The two polls this page no longer runs
 *
 * `/operations/fleet/health` (10 s) and `/operations/fleet/resource-samples`
 * (30 s) ran here unconditionally — including while the drawer was collapsed —
 * purely so the `N unhealthy` / `N refusing work` / `N delaying work` /
 * `N stale` / `N unknown` alarm could stay visible on the collapsed header.
 * With Dev Ops as a real nav destination that alarm belongs on the
 * `Dev Ops ▾` group trigger (`CoordNav`'s `useFleetAlarmBadge`, 60 s), where
 * it is visible from EVERY console page rather than from this one. Both polls
 * are therefore gone from here, not moved: this page makes zero requests to
 * either route.
 *
 * The `unknown` badge moved with the rest and must never be dropped — see
 * `useFleetAlarmBadge`'s docblock for why a breach-only badge would be a
 * false-safe.
 */

import {
  CiStatusPanel,
  MergePipeline,
  StuckPrRecoveryPanel,
} from "@/components/operations";

export default function CoordPipelinePage() {
  return (
    // `overflow-x-auto`: wide panels (the train rows, a row's dependency DAG)
    // scroll instead of stranding action buttons off-screen. Vertical scroll
    // comes from the coord layout's <main overflow-y-auto>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-pipeline-page"
    >
      {/* Above the hero, and only when there IS one: the tenant's own door out
          of a wedged merge train (plan
          2026-07-30-coord-tenant-self-service-merge-recovery Phase 4). coord
          already detects and nudges; this is the remediation attached to the
          alarm. Renders null when nothing is stuck, so a healthy day looks
          exactly as it did before. */}
      <StuckPrRecoveryPanel />

      {/* The hero: unified PR pipeline (health strip + one row per PR). */}
      <MergePipeline />

      {/* Directly under the hero rather than one disclosure away: "main is red"
          and "this PR's checks are failing" are the two most common answers to
          the question the hero asks, so the evidence sits with the symptom. */}
      <CiStatusPanel />
    </div>
  );
}
