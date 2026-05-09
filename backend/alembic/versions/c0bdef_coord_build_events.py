"""coord.build_events — Tinderbox-style peer-visible build status

Revision ID: c0bdef_coord_build_events
Revises: a6f606408ecb
Create Date: 2026-05-09

Phase B1 of the coord-tinderbox-build-status plan
(``D:/qontinui-root/plans/coord-tinderbox-build-status-2026-05-09.md``).

Creates ``coord.build_events`` — an immutable per-build outcome record.
Distinct from ``coord.machine_status`` (mutable "what is each machine
doing right now"); this table records the outcome of every supervisor
build pool run so peers can see "is the runner red on machine X right
now?" without polling GitHub Actions.

Lifecycle:

* ``POST /coord/builds/start`` inserts a row with ``result=NULL`` (in
  progress).
* ``POST /coord/builds/finish`` updates the same row with
  ``ended_at`` / ``result`` / ``duration_ms`` / optional error fields.
* A 7-day rolling prune sweep in ``qontinui-coord`` deletes old rows.

Schema choices:

1. ``machine_id`` is FK to ``coord.machines.machine_id`` ON DELETE
   CASCADE — matches the rest of the coord audit-log surface
   (``machine_status``, ``claims_audit``).
2. No CHECK constraint on ``result`` — kept open for forward
   compatibility (``'success' | 'failure' | 'cancelled' | NULL``).
3. ``slot`` is INTEGER — supervisor's ``BuildSlot.id`` is ``usize``,
   and the small ints fit comfortably.
4. Three indexes:
   * ``(machine_id, started_at DESC)`` — single-machine history.
   * ``(repo, started_at DESC)`` — peer queries scoped to a repo.
   * partial ``(started_at DESC) WHERE result IS NOT NULL`` —
     "completed builds" hot path for the consensus / summary endpoint.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c0bdef_coord_build_events"
down_revision: str = "a6f606408ecb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "build_events",
        sa.Column(
            "build_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "machine_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.machines.machine_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "ended_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "result",
            sa.Text(),
            nullable=True,
            comment="success | failure | cancelled | NULL while running",
        ),
        sa.Column(
            "duration_ms",
            sa.BigInteger(),
            nullable=True,
        ),
        sa.Column(
            "slot",
            sa.Integer(),
            nullable=True,
            comment="supervisor build pool slot id (0..N)",
        ),
        sa.Column(
            "requester_id",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "head_sha",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "error_summary",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "error_file",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema="coord",
    )
    op.create_index(
        "build_events_machine_idx",
        "build_events",
        ["machine_id", sa.text("started_at DESC")],
        schema="coord",
    )
    op.create_index(
        "build_events_repo_idx",
        "build_events",
        ["repo", sa.text("started_at DESC")],
        schema="coord",
    )
    op.create_index(
        "build_events_recent_idx",
        "build_events",
        [sa.text("started_at DESC")],
        schema="coord",
        postgresql_where=sa.text("result IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.build_events_recent_idx")
    op.execute("DROP INDEX IF EXISTS coord.build_events_repo_idx")
    op.execute("DROP INDEX IF EXISTS coord.build_events_machine_idx")
    op.drop_table("build_events", schema="coord")
