"""page-spec 01 coord.page_spec_paths — page-spec → covered-path map oplog

Revision ID: page_spec_01_coord_page_spec_paths
Revises: land_effect_01_coord_land_tables
Create Date: 2026-06-04

Phase 2 of the page-spec path-map producer plan
(``D:/qontinui-root/plans/2026-06-04-page-spec-path-map-producer-plan.md``).

Creates the ``coord.page_spec_paths`` overlay table — a producer-keyed map of
which source paths a given page spec covers, as observed at a specific producing
commit (``head_sha``). Consumed by qontinui-coord (Rust), which cannot author
DDL — Alembic in qontinui-web is the sole author of the ``coord.*`` schema.

Each row records that, at ``head_sha`` of ``repo``, page ``page_id`` covers
``covered_path``. A ``covered_path`` ending in ``/`` is a directory prefix;
otherwise it is an exact file path. ``app_id`` is the multi-app Spec API slug
(e.g. ``qontinui-runner``) and is NULL for the default app.

Design notes (mirrors the ``coord.edit_verifications`` / ``coord.fs_observations``
best-effort overlay posture authored in
``edit_effect_01_coord_edit_effect_tables``):

* Best-effort overlay/observation table — web-alembic-authored, but NOT added to
  coord's boot gate (that is a coord-repo concern, intentionally absent here).
* ``coord`` already exists (created by
  ``consolidation_phase1_01_infrastructure``); this migration does NOT
  ``CREATE SCHEMA``.
* The ``now()`` default is a plain column default (evaluated per-row at INSERT) —
  fine; only a problem inside a partial-index predicate (none used here).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "page_spec_01_coord_page_spec_paths"
down_revision: str = "land_effect_01_coord_land_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- coord.page_spec_paths : page-spec → covered-path map oplog ----------
    op.create_table(
        "page_spec_paths",
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("page_id", sa.Text(), nullable=False),
        # Trailing ``/`` = directory prefix; otherwise an exact file path.
        sa.Column("covered_path", sa.Text(), nullable=False),
        # Full 40-hex git sha of the producing repo's commit.
        sa.Column("head_sha", sa.Text(), nullable=False),
        # Multi-app Spec API slug (e.g. "qontinui-runner"); NULL = default app.
        sa.Column("app_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "repo",
            "page_id",
            "covered_path",
            "head_sha",
            name="page_spec_paths_pkey",
        ),
        schema="coord",
    )
    # Hot lookup: paths covered at a given (repo, head_sha) ordered by path.
    op.create_index(
        "idx_page_spec_paths_repo_head_path",
        "page_spec_paths",
        ["repo", "head_sha", "covered_path"],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_page_spec_paths_repo_head_path",
        table_name="page_spec_paths",
        schema="coord",
    )
    op.drop_table("page_spec_paths", schema="coord")
