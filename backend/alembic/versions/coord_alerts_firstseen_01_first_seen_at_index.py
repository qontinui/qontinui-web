"""coord.alerts: an index leading with ``first_seen_at`` for trailing-window reads.

Phase 6 (web side) of plan
``qontinui-dev-notes/plans/2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first.md``.
Additive, index-only.

The statement this serves
==========================================================================

The plan's Phase 6 adds a whitelisted ``sql_count`` query to coord,
``ops_judge_service_first_share_30d``: the share of trailing-30-day
``coord.alerts`` episodes first observed by a service. Its selection is a range
on ``first_seen_at`` across ALL kinds::

    ... FROM coord.alerts WHERE first_seen_at >= now() - interval '30 days'

``coord.alerts`` holds ~1.5 M rows, and no index leads with ``first_seen_at``.
The nearest, ``idx_alerts_kind_first_seen_at`` (``coord_iops_idx_01``), keys
``(kind, first_seen_at)``: it serves a range probe for ONE kind. A query with
no ``kind`` equality can still name it — the planner will put ``first_seen_at``
in its ``Index Cond`` (measured, PG16) — but on a non-leading column that
condition bounds nothing: PostgreSQL 16 has no skip scan, so the scan walks
EVERY entry of the index and filters them, ~1.5 M per evaluation, whatever the
window holds. This index turns it into a range scan bounded by the window.

The key is ``(first_seen_at)`` alone, with no partial predicate: the window
moves, so any fixed predicate would stop covering it, and the column is set
once by its ``DEFAULT now()`` and never rewritten, so the index adds no HOT
penalty on the alert-upsert path (an upsert that does not change an indexed
column stays HOT-eligible).

``CONCURRENTLY``, and the INVALID-index trap
==========================================================================

``CREATE INDEX CONCURRENTLY`` rather than a plain build: ``coord.alerts`` is a
live table under a continuous writer, and a plain ``CREATE INDEX`` would take a
write-blocking ``SHARE`` lock for the whole build. CONCURRENTLY cannot run
inside a transaction and ``env.py`` wraps the migration batch in one, hence
``op.get_context().autocommit_block()`` — the ``coord_alerts_pagedidx_01`` /
``coord_iops_idx_01`` shape. On a fresh CI database the table is empty, so the
build is instant.

No in-migration guards, deliberately — the ``coord_iops_idx_01`` reasoning.
coord's migration classifier (``pr_merge/migration_classifier.rs``) is
fail-closed: it rejects a read through ``op.get_bind().execute``, any ``DROP``
on the upgrade path, and ``RESET``, so a revision that probes for and drops an
INVALID leftover is held off the auto-land path. This revision is the provable
form. The hazard is handled AFTER the deploy instead, by a check that must be
run and recorded::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_alerts_first_seen_at';

It must read ``indisvalid = true``. A killed build leaves an INVALID index that
``IF NOT EXISTS`` skips on any later run, so it would never serve a query. The
recovery is a follow-up revision that runs ``DROP INDEX CONCURRENTLY IF EXISTS
coord.idx_alerts_first_seen_at`` and then this revision's CREATE again, once
``pg_stat_progress_create_index`` shows no build on the table. Never a plain
``DROP INDEX``.

Every reader is correct WITHOUT this index, only slower, so there is no
column-before-migration hazard with coord. ``downgrade`` drops it
CONCURRENTLY.

Revision ID: coord_alerts_firstseen_01
Revises: coord_alerts_onset_01
Create Date: 2026-09-30

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_firstseen_01"
# One line, unannotated — see plan_library_06_scan_root_slug_census.
down_revision = "coord_alerts_onset_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY index on ``first_seen_at``. Idempotent."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL inside `op.execute(...)` to prove
        # every CREATE/DROP names its schema, and an interpolated string is not
        # statically analysable.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_first_seen_at
            ON coord.alerts (first_seen_at)
            """
        )


def downgrade() -> None:
    """Reverse the additive index. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_first_seen_at")
