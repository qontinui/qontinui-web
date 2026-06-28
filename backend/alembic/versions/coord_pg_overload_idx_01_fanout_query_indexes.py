"""coord PG overload fix: indexes for 3 unindexed per-tick fan-out queries.

Root cause (investigated 2026-06-28): coord's per-tick fan-out loops issue
queries with no usable index that full-seq-scan continuously-growing
``coord.*`` tables until they cross the 60s ``statement_timeout``, pinning a
pooled connection for the full 60s each. The loops launch many concurrently,
exhausting coord's PG pool -> ``pg_watchdog`` trips, ``/ready`` 503-flaps, the
leader heartbeat misses its 15s lease TTL (leader thrash), and unbounded
handlers (device pairing) hang past the web proxy's 10s timeout -> the
runner-login 504. RDS itself is healthy (CPU ~37%, fast IO) -- the tell is
DiskQueueDepth spiking while connections pin ~290/360: IO-bound seq scans
hitting the gp3 IOPS cap, not a lock/deadlock/capacity problem.

Three queries, three missing indexes:

1. ``coord.policy_rule_resolutions`` -- ``calibration::fetch_outcome_counts_by_domain``
   (fleet-wide policy calibration, fans out over ~6 safety domains x drift
   classes every decision)::

       WHERE resolved_entity->>'decision_domain' = $1
         AND resolved_entity->>'surface'         = $2
         AND outcome_category IS NOT NULL
       GROUP BY outcome_category

   The existing ``idx_policy_rule_resolutions_tenant_domain_resolved`` is
   ``(tenant_id, (resolved_entity->>'decision_domain'), resolved_at DESC)`` --
   led by ``tenant_id``, but this read is FLEET-WIDE (no tenant filter), so a
   tenant-led b-tree cannot serve it -> full seq scan. The new expression
   index drops the tenant prefix, adds the ``surface`` field, and carries
   ``outcome_category`` (covers the GROUP BY); partial on the query's own
   ``outcome_category IS NOT NULL`` filter to stay small.

2. ``coord.pr_events`` -- ``pr_merge::newest_block_reason_code`` (mergestate_heal,
   fans out over every governed repo's open PRs)::

       WHERE repo = $1 AND pr_number = $2 AND event_kind = 'predicate_eval'
       ORDER BY created_at DESC LIMIT 1

   With only ``(repo, pr_number, created_at DESC)`` and ``(event_kind,
   created_at DESC)`` available, the planner can pick the event_kind index and
   scan ALL ``predicate_eval`` rows globally newest-first when this PR's match
   is old/absent. The new composite matches the predicate exactly for an
   instant index scan + LIMIT 1.

3. ``coord.worktree_census`` -- ``worktree_census::prune_census``::

       DELETE WHERE observed_at < now() - make_interval(secs => $1)

   The existing ``idx_worktree_census_device_observed_at`` is
   ``(device_id, observed_at DESC)`` -- led by ``device_id``, but the prune is
   a global time-based delete with no device filter -> unusable -> seq scan.
   The new ``(observed_at)`` index serves the retention sweep.

The affected READS all fail open (calibration -> provenance prior; twin counts
-> zero/gate-holds; mergestate_heal -> skip), so the functional blast radius is
low -- it is the connection pinning that cascades. These indexes turn the seq
scans into bounded lookups and end the IO storm.

``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``): these tables are
hot/append-heavy, so an in-transaction build would take a write-blocking
``SHARE`` lock and worsen the very incident this fixes. CONCURRENTLY cannot run
inside a transaction, hence ``op.get_context().autocommit_block()`` (same
precedent as ``gate_action_02`` / ``uh32g7h8i9d0``). On the CI fresh DB the
tables are tiny so the builds are instant. Additive / forward-only /
expand-only: ``upgrade`` creates each index ``IF NOT EXISTS``; ``downgrade``
drops ``IF EXISTS``. No table or column is altered.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index
of the same name; ``IF NOT EXISTS`` would then skip recreation. If that ever
happens, manually ``DROP INDEX`` the invalid index and re-run -- it is not
expected in normal forward migration.

Revision ID: coord_pg_overload_idx_01
Revises: coord_sessions_provider
Create Date: 2026-06-28

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pg_overload_idx_01"
down_revision: str | None = "coord_sessions_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: three CONCURRENTLY expression/composite indexes. Idempotent."""
    with op.get_context().autocommit_block():
        # 1. Fleet-wide policy calibration read (PRIMARY hog).
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_policy_rule_resolutions_domain_surface_labeled
            ON coord.policy_rule_resolutions (
                (resolved_entity->>'decision_domain'),
                (resolved_entity->>'surface'),
                outcome_category
            )
            WHERE outcome_category IS NOT NULL
            """
        )
        # 2. mergestate_heal newest predicate_eval lookup.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_repo_pr_kind_created
            ON coord.pr_events (repo, pr_number, event_kind, created_at DESC)
            """
        )
        # 3. worktree_census global retention prune.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_worktree_census_observed_at
            ON coord.worktree_census (observed_at)
            """
        )


def downgrade() -> None:
    """Reverse the three additive indexes. Tables + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_worktree_census_observed_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_events_repo_pr_kind_created"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_policy_rule_resolutions_domain_surface_labeled"
        )
