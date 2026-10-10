"""coord.memory_records: the three provenance/altitude indexes.

Phase 1, migration 3 of plan
``qontinui-dev-notes/plans/2026-08-06-user-and-device-facets-on-memories-and-findings.md``
(§5). Split out of ``memfacets_01``, whose docstring ("Indexes") carries the
index design — including why the altitude index is led by ``tenant_id``.

Why a revision of its own
==========================================================================

coord's merge-train migration classifier
(``qontinui-coord/crates/coord/src/pr_merge/migration_classifier.rs``)
admits exactly one index build: ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
inside ``op.get_context().autocommit_block()``. That block COMMITS the
transaction ``env.py`` opened. Inside ``memfacets_01`` it would have made the
columns and FKs durable before alembic stamped that revision, so a failed or
killed build would leave a database every later ``upgrade`` fails on (the
non-idempotent ``ADD CONSTRAINT``). Here every statement is ``IF NOT
EXISTS``, so a re-run after a failed build simply carries on.

The commit also means ``memfacets_01`` and ``findfacets_02`` are stamped and
durable before the first build starts.

⚠ The INVALID-index trap (precedent ``coord_alerts_flakeidx_01``): a KILLED
CONCURRENTLY build leaves an INVALID index of the same name, which
``IF NOT EXISTS`` then skips — the revision reports success while the index
never serves a query. Verify with ``pg_index.indisvalid``, not existence; if
one is invalid, ``DROP INDEX`` it and re-run. On this ~5.7k-row table each
build takes milliseconds.

Revision ID: memfacets_03
Revises: findfacets_02
Create Date: 2026-10-02

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "memfacets_03"
down_revision: str | Sequence[str] | None = "findfacets_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Three CONCURRENTLY partial indexes. Idempotent."""
    # Static literals, never f-strings: both coord's classifier and the
    # alembic-schema-arg-gate pre-commit hook parse the SQL text.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_records_user
                ON coord.memory_records (user_id)
                WHERE user_id IS NOT NULL AND is_tombstone = false
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_records_device
                ON coord.memory_records (device_id)
                WHERE device_id IS NOT NULL AND is_tombstone = false
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_records_altitude
                ON coord.memory_records (tenant_id, applies_at)
                WHERE is_tombstone = false
            """
        )


def downgrade() -> None:
    """Drop the three indexes. The columns and every row survive."""
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_altitude")
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_device")
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_user")
