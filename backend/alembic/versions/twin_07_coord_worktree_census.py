"""twin 07 coord.worktree_census + coord.worktree_volume — Ξ_Worktree census oplogs

Revision ID: twin_07_coord_worktree_census
Revises: semres_02_tool_registry_grammar
Create Date: 2026-06-02

Phase 1 (web migration) of the Ξ_Worktree observer plan.

Creates two **append-only** ``coord.*`` tables consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema (enforced coord-side by ``tests/coord_schema_authorship.rs``):

* ``coord.worktree_census`` — one row per observed worktree per census tick: its
  git identity (repo / path / branch / HEAD sha + age), dirtiness, and the
  per-artifact (node_modules + build target) presence / junction / byte-size
  footprint, plus the ``attributable_bytes`` total (non-junction "real" bytes
  the worktree is actually responsible for on disk).
* ``coord.worktree_volume`` — one row per observed disk volume per census tick:
  its total / free byte capacity. Lets the observer relate accumulated worktree
  footprint to remaining headroom on each machine's drive.

Design notes (mirrors ``twin_05_coord_health_observations`` /
``edit_effect_01_coord_edit_effect_tables`` conventions):

* No unique constraints — both are intentionally history oplogs; the same
  ``(device_id, repo, path, …)`` tuple recurs every census tick.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.
* The ``now()`` defaults are plain column defaults (evaluated per-row at INSERT) —
  fine; only a problem inside a partial-index predicate (none used here).
* Hot lookup per table is ``(device_id, observed_at DESC)`` — the latest census
  rows for a given machine's runner. ``worktree_census`` additionally indexes
  ``(repo, path)`` for the per-worktree history lookup.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_07_coord_worktree_census"
down_revision: str = "semres_02_tool_registry_grammar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- coord.worktree_census : one row per observed worktree per tick ------
    op.create_table(
        "worktree_census",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        # Which machine's runner reported this census row.
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=False),
        # Absolute worktree path on that machine.
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("branch", sa.Text(), nullable=True),
        sa.Column("head_sha", sa.Text(), nullable=True),
        # Age of the HEAD commit, in seconds.
        sa.Column("head_age_secs", sa.BigInteger(), nullable=True),
        sa.Column(
            "is_dirty",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # node_modules footprint.
        sa.Column(
            "nm_present",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "nm_is_junction",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "nm_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        # Build target footprint (e.g. cargo target / dist).
        sa.Column(
            "target_present",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "target_is_junction",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "target_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("last_access_mtime", sa.DateTime(timezone=True), nullable=True),
        # Non-junction (real) bytes only — what this worktree truly owns on disk.
        sa.Column(
            "attributable_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    # Hot lookup: the latest census rows for a given machine's runner.
    op.create_index(
        "idx_worktree_census_device_observed_at",
        "worktree_census",
        ["device_id", sa.text("observed_at DESC")],
        schema="coord",
    )
    # Per-worktree history lookup.
    op.create_index(
        "idx_worktree_census_repo_path",
        "worktree_census",
        ["repo", "path"],
        schema="coord",
    )

    # --- coord.worktree_volume : one row per observed disk volume per tick ----
    op.create_table(
        "worktree_volume",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        # The volume identifier, e.g. "D:".
        sa.Column("volume", sa.Text(), nullable=False),
        sa.Column("total_bytes", sa.BigInteger(), nullable=False),
        sa.Column("free_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    # Hot lookup: the latest volume rows for a given machine's runner.
    op.create_index(
        "idx_worktree_volume_device_observed_at",
        "worktree_volume",
        ["device_id", sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_worktree_volume_device_observed_at",
        table_name="worktree_volume",
        schema="coord",
    )
    op.drop_table("worktree_volume", schema="coord")

    op.drop_index(
        "idx_worktree_census_repo_path",
        table_name="worktree_census",
        schema="coord",
    )
    op.drop_index(
        "idx_worktree_census_device_observed_at",
        table_name="worktree_census",
        schema="coord",
    )
    op.drop_table("worktree_census", schema="coord")
