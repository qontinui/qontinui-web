"use client";

/**
 * /admin/coord/migrations — the alembic reservation queue.
 *
 * Plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 4. The
 * queue used to be a tile two disclosures deep inside the pipeline page's
 * `System details` drawer, paired with the dev-action ledger for no better
 * reason than that both were narrow lists.
 *
 * **Why Dev Ops and not Merge** (the plan's resolved Q4): the reservation
 * queue is a shared *resource* — coord assigns each migration its
 * `down_revision` off the merged chain head or the queue tail, so racing
 * authors stack into an order instead of forking the alembic graph. That a
 * queued reservation can hold a PR up is a *consequence* of contention on the
 * resource, not what the resource is. Filing it under `Merge ▾` would put a
 * resource queue in the section named for the merge chain — the same category
 * error this plan's Gap 1 exists to undo, run in reverse.
 *
 * The merge-side need is carried by a cross-link instead: a `MergePipeline`
 * row that is waiting names this page in its expansion.
 *
 * The queue is per-repo (coord requires `repo`), so the panel carries its own
 * repo control, seeded from the active tenant's first registered repo. This
 * page adds no read of its own — `MigrationQueueTile` owns the one poll.
 */

import { MigrationQueueTile } from "@/components/operations";

export default function CoordMigrationsPage() {
  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-migrations-page">
      <p className="text-xs text-muted-foreground">
        Coord&rsquo;s authoritative migration-reservation queue, one ordered
        live set per repo. A reservation is a claim on the next
        <code className="mx-1">down_revision</code> for that repo&rsquo;s
        alembic chain, so two authors racing a migration stack into an order
        rather than forking the graph. Rows are reservations, not pull requests:
        coord&rsquo;s queue read carries no PR number, so this page cannot say
        which PR a slot is holding up.
      </p>
      <MigrationQueueTile />
    </div>
  );
}
