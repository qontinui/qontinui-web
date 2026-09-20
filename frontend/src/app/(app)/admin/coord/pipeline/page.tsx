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
 * ## What this page is
 *
 * Everything here answers ONE question: *where is my PR and is it stuck?*
 *
 *  - `StuckPrRecoveryPanel` — the tenant's own door out of a wedged train.
 *    Renders `null` when nothing is stuck.
 *  - `MergePipeline` — the hero, and now the whole page: health strip, filter
 *    tabs, one row per PR, with everything that is ABOUT a PR inside that
 *    PR's own expansion (failing checks, the blast-radius gate's decision,
 *    every merge attempt, the cross-repo dependency DAG).
 *
 * ## Two panels, one axis (2026-09-19)
 *
 * The page used to be three components deep and the hero five sections tall,
 * because every new fact about the merge system arrived as a new section. The
 * redesign applies one rule — *a fact about a PR belongs in that PR's row; a
 * fact about all of them belongs in the health strip; a fact on another axis
 * belongs on the view that owns that axis* — and the page falls out of it.
 * `MergePipeline`'s own header records what moved where and why.
 *
 * **`CiStatusPanel` is gone from this page, and that reverses Phase 4's
 * decision deliberately.** Phase 4 promoted it out of the deleted `System
 * details` drawer to sit directly under the hero, on the reasoning that "CI
 * results are why PRs are stuck". The reasoning was right and the placement
 * was not, for three reasons that are in `CiRepoStrip`'s module header: it is
 * a row-per-REPO list in a stack of row-per-PR lists; its headline claim (main
 * is red) is already made louder by `RedMainBanner`, which the coord LAYOUT
 * mounts on every route; and it polled for every visitor to this page whether
 * or not they opened it, because its stream was owned above its own
 * `<CollapsiblePanel>`. It now lives on the Train tab — this page's existing
 * repo-axis view — and owns its transport, so it is mounted only while
 * someone is reading it.
 *
 * ## The two polls this page has never run since Phase 4
 *
 * `/operations/fleet/health` (10 s) and `/operations/fleet/resource-samples`
 * (30 s) ran on the old `/admin/coord/fleet` unconditionally — including while
 * the drawer was collapsed — purely so the `N unhealthy` / `N refusing work` /
 * `N delaying work` / `N stale` / `N unknown` alarm could stay visible on the
 * collapsed header. With Dev Ops as a real nav destination that alarm belongs
 * on the `Dev Ops ▾` group trigger (`CoordNav`'s `useFleetAlarmBadge`, 60 s),
 * where it is visible from EVERY console page rather than from this one. Both
 * polls are therefore gone from here, not moved: this page makes zero requests
 * to either route, and `page.test.tsx` is what keeps that true.
 *
 * The `unknown` badge moved with the rest and must never be dropped — see
 * `useFleetAlarmBadge`'s docblock for why a breach-only badge would be a
 * false-safe.
 *
 * ## Where the other panels went
 *
 * `HealthSummaryCard`, `FleetOverview` and `FleetResourcesSection` are on
 * `/admin/coord/devops`; `FleetTestTargetsPanel` and `MigrationQueueTile` are
 * their own Dev Ops routes; `DevActionsTile` joined the agent-activity ledger
 * at `/admin/coord/agents`; `GatesPanel` is gone in favour of
 * `/admin/coord/gates`, which already held a strict superset of its actions;
 * `LandedFeaturesPanel` is deleted outright.
 */

import { MergePipeline, StuckPrRecoveryPanel } from "@/components/operations";

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

      {/* The hero, and the page: unified PR pipeline (health strip + one row
          per PR + one collapsed residue panel). */}
      <MergePipeline />
    </div>
  );
}
