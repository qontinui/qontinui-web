"""coord.alerts: partial index on ``resolved_at`` for trailing-window resolution reads.

Phase 6 (web side) of plan
``qontinui-dev-notes/plans/2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first.md``.
Additive, index-only.

The statement this serves
==========================================================================

The plan's Phase 6 adds a whitelisted ``sql_count`` query to coord,
``ops_decide_zero_touch_share_30d``: the share of alert episodes RESOLVED in the
trailing 30 days that carry no ``coord.operator_touches`` row in their span. Its
episode set is bounded by::

    ... FROM coord.alerts WHERE resolved_at >= now() - interval '30 days'

``coord.alerts`` holds ~1.5 M rows and no index keys ``resolved_at`` at all —
the table's ``resolved_at`` partials (``idx_alerts_active_severity``,
``idx_alerts_claim_expiry``, ...) select the OPEN rows (``resolved_at IS
NULL``), the complement of this read — so every evaluation walks the heap.

Key column and predicate
==========================================================================

The key is ``(resolved_at)``, so the window is a bounded range scan. The
partial predicate ``WHERE resolved_at IS NOT NULL`` keeps the open alerts
(tens of thousands, and the rows the upsert path rewrites most) out of the
index; the planner proves it from the query's own range, because
``resolved_at >= <expr>`` implies ``resolved_at IS NOT NULL``. A row enters the
index once, when it resolves.

``CONCURRENTLY``, and the INVALID-index trap
==========================================================================

``CREATE INDEX CONCURRENTLY`` rather than a plain build: ``coord.alerts`` is a
live table under a continuous writer, and a plain ``CREATE INDEX`` would take a
write-blocking ``SHARE`` lock for the whole build. CONCURRENTLY cannot run
inside a transaction and ``env.py`` wraps the migration batch in one, hence
``op.get_context().autocommit_block()`` — the ``coord_alerts_pagedidx_01`` /
``coord_iops_idx_01`` / ``coord_alerts_firstseen_01`` shape. On a fresh CI
database the table is empty, so the build is instant.

No in-migration guards, deliberately — the ``coord_iops_idx_01`` reasoning.
coord's migration classifier (``pr_merge/migration_classifier.rs``) is
fail-closed: it rejects a read through ``op.get_bind().execute``, any ``DROP``
on the upgrade path, and ``RESET``, so a revision that probes for and drops an
INVALID leftover is held off the auto-land path. This revision is the provable
form. The hazard is handled AFTER the deploy instead, by a check that must be
run and recorded::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_alerts_resolved_at';

It must read ``indisvalid = true``. A killed build leaves an INVALID index that
``IF NOT EXISTS`` skips on any later run, so it would never serve a query. The
recovery is a follow-up revision that runs ``DROP INDEX CONCURRENTLY IF EXISTS
coord.idx_alerts_resolved_at`` and then this revision's CREATE again, once
``pg_stat_progress_create_index`` shows no build on the table. Never a plain
``DROP INDEX``.

Every reader is correct WITHOUT this index, only slower, so there is no
column-before-migration hazard with coord. ``downgrade`` drops it
CONCURRENTLY.

Revision ID: coord_alerts_resolvedidx_01
Revises: coord_alerts_firstseen_01
Create Date: 2026-09-30

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_resolvedidx_01"
# One line, unannotated — see plan_library_06_scan_root_slug_census.
down_revision = "coord_alerts_firstseen_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial index on ``resolved_at``. Idempotent."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL inside `op.execute(...)` to prove
        # every CREATE/DROP names its schema, and an interpolated string is not
        # statically analysable.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_resolved_at
            ON coord.alerts (resolved_at)
            WHERE resolved_at IS NOT NULL
            """
        )


def downgrade() -> None:
    """Reverse the additive index. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_resolved_at")
