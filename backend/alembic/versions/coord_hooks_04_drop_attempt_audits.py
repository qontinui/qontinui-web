"""coord — DROP coord.attempt_audits (the dead preview-verify verdict store)

Revision ID: coord_hooks_04_drop_attempt_audits
Revises: fpl_02b
Create Date: 2026-11-09

Phase 6 of plan
``2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close``.

``coord.attempt_audits`` (created by ``coord_hooks_03_attempt_audits``) held
one preview-verify verdict per ``(unit_id, attempt_id)``. Its writers were
coord's anonymous ``POST /preview-audit/verdict`` ingest and the test-only
preview-verify hook. Its one reader was the merge scheduler's dequeue path.
qontinui-coord#3899 (landed as ``0d69d34fb``) deleted all three, together with
coord's ``ensure_attempt_audits_table`` self-heal. It also moved the name from
``ALEMBIC_OWNED_TABLES`` to ``PENDING_DROP_COORD_TABLES``.

## Why a drop and not a rename (K-D4)

K-D4 renames a table that still has rows to ``retired_<name>``. It drops an
empty one outright. The re-measure on 2026-11-09 ran against the coord serving
``7695197cd`` (which contains ``0d69d34fb``). It read the production count
through coord's whitelisted ``sql_count`` query ``pending_drop_table_rows``,
whose pending-drop set holds only ``attempt_audits``:

* ``lte 0`` cleared, and the control ``gt 0`` read open;
* ``schema_object_exists coord.attempt_audits`` cleared, so the 0 is a count of
  a present table, not the absent-table arm of the query.

So the table is empty and is dropped.

## What it drops

The two secondary indexes and the table. Nothing has an FK into
``coord.attempt_audits`` (no FK constraints were ever created on it).

## Reversibility

``downgrade`` re-creates the table and both indexes in exactly the shape
``coord_hooks_03_attempt_audits`` created them, so the reversal gate's
``upgrade -> downgrade -1 -> upgrade`` round trip works on an empty DB. The
table was empty at the drop, so no data is lost either way.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_hooks_04_drop_attempt_audits"
down_revision: str | Sequence[str] | None = "fpl_02b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_attempt_audits_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_attempt_audits_unit")
    op.execute("DROP TABLE IF EXISTS coord.attempt_audits")


def downgrade() -> None:
    # Same guard as coord_hooks_03's upgrade: a coord build predating #3899
    # self-heals this table, so it may already be back.
    if sa.inspect(op.get_bind()).has_table("attempt_audits", schema="coord"):
        return
    op.create_table(
        "attempt_audits",
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "attempt_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("'00000000-0000-0000-0000-000000000000'"),
        ),
        sa.Column("gate", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("all_passed", sa.Boolean(), nullable=True),
        sa.Column(
            "results",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "preflight",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "preview",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("unit_id", "attempt_id"),
        schema="coord",
    )
    op.create_index(
        "idx_attempt_audits_unit",
        "attempt_audits",
        ["unit_id", sa.text("created_at DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_attempt_audits_tenant",
        "attempt_audits",
        ["tenant_id"],
        schema="coord",
        postgresql_where=sa.text("tenant_id IS NOT NULL"),
    )
