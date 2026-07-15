"""runner-as-CI-node Phase 0 — coord.ci_dispatches ledger + canonical_repos.ci_lane

Revision ID: cinode_01_dispatch_ledger
Revises: coord_pr_check_runs_latest_view
Create Date: 2026-07-15

Phase 0 (web DDL) of the runner-as-CI-node migration
(``qontinui-dev-notes/plans/2026-07-15-runner-as-ci-node-migration.md``):
the runner app registers as dispatchable CI capacity, coord dispatches
candidate builds to connected runners, GitHub Actions remains the
fallback lane.

Two DDL objects, both dark until coord's dispatch flag
(``COORD_CI_DISPATCH_TO_RUNNERS_ENABLED``, Phase 3) is armed:

1. ``coord.ci_dispatches`` — the CI dispatch ledger (plan §4.5). One row
   per dispatch attempt; coord INSERTs the row *before* publishing
   ``events.ci.build_requested.<device_id>`` (claim-first, the same
   claim-before-spawn lesson as the unlandable-shepherd spawn storm).
   The UNIQUE partial index ``uq_ci_dispatches_active_proposal`` on
   ``(proposal_id) WHERE state IN ('queued','dispatched','running')``
   is the load-bearing dedup: at most one live dispatch per proposal.
   ``lease_expires_at`` is renewed by runner progress POSTs; a
   leader-gated sweeper marks expired ``running`` rows ``lost`` so the
   existing requeue path fires. ``log_tail``/``summary`` hold a bounded
   log tail (~64 KB) + result summary; full logs stay on the device.

2. ``coord.canonical_repos.ci_lane`` — per-repo lane policy (plan §4.2):
   ``github`` (default, today's behavior), ``shadow`` (dispatch to a
   runner in addition to the GitHub lane, non-required check name),
   ``runner`` (the runner verdict is the authoritative context).

All DDL is idempotent (IF NOT EXISTS) — safe against a canonical PG
where a coord self-heal already added objects. No backfill needed:
``ci_lane`` defaults every existing repo to ``github`` (zero behavior
change) and ``ci_dispatches`` starts empty.

``down_revision`` chains off the local head
(``coord_pr_check_runs_latest_view``); coord re-points at land time.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_01_dispatch_ledger"
down_revision: str = "coord_pr_check_runs_latest_view"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.ci_dispatches + add canonical_repos.ci_lane. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ----------------------------------------------------------------
    # 1. The dispatch ledger. States: queued -> dispatched -> running ->
    #    succeeded|failed; lost (lease expired) and cancelled are the
    #    non-happy terminals. No FKs: dispatch rows must not block on
    #    device/proposal lifecycle (matching the soft-pointer posture of
    #    the other coord.* operational tables).
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_dispatches (
            dispatch_id      UUID NOT NULL,
            tenant_id        UUID NOT NULL,
            repo             TEXT NOT NULL,
            proposal_id      UUID NOT NULL,
            head_sha         TEXT NOT NULL,
            device_id        UUID NOT NULL,
            state            TEXT NOT NULL DEFAULT 'queued'
                CONSTRAINT ck_ci_dispatches_state CHECK (
                    state IN ('queued','dispatched','running',
                              'succeeded','failed','lost','cancelled')
                ),
            check_name       TEXT NOT NULL,
            lease_expires_at TIMESTAMPTZ NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at       TIMESTAMPTZ NULL,
            completed_at     TIMESTAMPTZ NULL,
            log_tail         TEXT NULL,
            summary          JSONB NULL,
            PRIMARY KEY (dispatch_id)
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. Claim-first dedup (load-bearing): at most ONE live dispatch per
    #    proposal. Coord INSERTs under this index before publishing the
    #    build_requested event; a second dispatcher loses the INSERT
    #    race instead of double-dispatching. The state-list predicate is
    #    IMMUTABLE (no now()), so it is valid for a partial index.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_dispatches_active_proposal
            ON coord.ci_dispatches (proposal_id)
            WHERE state IN ('queued','dispatched','running')
        """
    )

    # Per-device load/status scans (selection + lease sweeper).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ci_dispatches_device_state
            ON coord.ci_dispatches (device_id, state)
        """
    )

    # Verdict-ingest lookups + liveness classifier: dispatches for a
    # candidate head SHA.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ci_dispatches_repo_head_sha
            ON coord.ci_dispatches (repo, head_sha)
        """
    )

    # ----------------------------------------------------------------
    # 3. Per-repo lane policy. NOT NULL DEFAULT 'github' backfills every
    #    existing row to today's behavior in the same statement.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            ADD COLUMN IF NOT EXISTS ci_lane TEXT NOT NULL DEFAULT 'github'
        """
    )
    # ADD COLUMN IF NOT EXISTS cannot attach the CHECK on the re-run
    # path, so the constraint is added separately and idempotently.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_canonical_repos_ci_lane'
                  AND conrelid = 'coord.canonical_repos'::regclass
            ) THEN
                ALTER TABLE coord.canonical_repos
                    ADD CONSTRAINT ck_canonical_repos_ci_lane
                    CHECK (ci_lane IN ('github','shadow','runner'));
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    """Reverse: drop the lane column + the dispatch ledger. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            DROP CONSTRAINT IF EXISTS ck_canonical_repos_ci_lane
        """
    )
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            DROP COLUMN IF EXISTS ci_lane
        """
    )
    op.execute("DROP TABLE IF EXISTS coord.ci_dispatches")
