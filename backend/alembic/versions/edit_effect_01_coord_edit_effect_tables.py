"""edit-effect 01 coord.fs_observations + coord.edit_verifications — edit-action effect-signature oplogs

Revision ID: edit_effect_01_coord_edit_effect_tables
Revises: bridge_audit_log_01
Create Date: 2026-06-02

Phase backing the edit-action effect-signatures plan
(``D:/qontinui-root/plans/2026-05-31-edit-action-effect-signatures-plan.md``).

Creates two **append-only** ``coord.*`` tables consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema:

* ``coord.fs_observations`` — one row per observed edited path (the FS observer's
  view of a single pre→post file change, with the unified-diff hunks + the D6
  coverage/credibility confidence pair).
* ``coord.edit_verifications`` — an oplog of every ``/coord/edits/verify`` call:
  the predicted edit effect (NULL for non-agent post-hoc edits), the per-subspace
  drift/D3 outcomes, and the composed outcome.

Design notes (mirrors ``twin_03_coord_dependency_observations`` /
``twin_01_coord_migration_observations`` conventions):

* ``composed_outcome`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.migration_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. Keep the allowed set in
  sync with the coord-side composer (built against this same contract).
* No unique constraints — both are intentionally history oplogs.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.
* The ``now()`` defaults are plain column defaults (evaluated per-row at INSERT) —
  fine; only a problem inside a partial-index predicate (none used here).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "edit_effect_01_coord_edit_effect_tables"
down_revision: str = "bridge_audit_log_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed composed outcomes — keep in sync with the coord-side edit-effect
# composer (built against this same contract).
_COMPOSED_OUTCOMES = (
    "confirmed",
    "surprise",
    "failure",
    "contradiction",
    "partial",
)


def upgrade() -> None:
    # --- coord.fs_observations : one row per observed edited path -----------
    op.create_table(
        "fs_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("agent_id", sa.Text(), nullable=True),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        # A newly-created file has no pre-image.
        sa.Column("pre_sha", sa.Text(), nullable=True),
        sa.Column("post_sha", sa.Text(), nullable=False),
        # Array of unified-diff hunks.
        sa.Column(
            "hunks",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "provenance",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'fs_observer:runner'"),
        ),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="coord",
    )
    op.create_index(
        "idx_fs_observations_correlation_id",
        "fs_observations",
        ["correlation_id"],
        schema="coord",
    )
    op.create_index(
        "idx_fs_observations_repo_path",
        "fs_observations",
        ["repo", "path"],
        schema="coord",
    )
    # Hot lookup: the latest observation (``ORDER BY observed_at DESC``).
    op.create_index(
        "idx_fs_observations_observed_at",
        "fs_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )

    # --- coord.edit_verifications : oplog of /coord/edits/verify calls ------
    op.create_table(
        "edit_verifications",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "verified_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=True),
        # Array of path strings.
        sa.Column(
            "paths",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Snapshot of the PredictedEditEffect; NULL for non-agent post-hoc edits.
        sa.Column("predicted", postgresql.JSONB(), nullable=True),
        # Map subspace -> {drift_class, d3_outcome, rationale}.
        sa.Column(
            "per_subspace",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("composed_outcome", sa.Text(), nullable=False),
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "composed_outcome IN ('confirmed','surprise','failure',"
            "'contradiction','partial')",
            name="edit_verifications_composed_outcome_chk",
        ),
        schema="coord",
    )
    op.create_index(
        "idx_edit_verifications_correlation_id",
        "edit_verifications",
        ["correlation_id"],
        schema="coord",
    )
    op.create_index(
        "idx_edit_verifications_repo",
        "edit_verifications",
        ["repo"],
        schema="coord",
    )
    # Hot lookup: the latest verification (``ORDER BY verified_at DESC``).
    op.create_index(
        "idx_edit_verifications_verified_at",
        "edit_verifications",
        [sa.text("verified_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_edit_verifications_verified_at",
        table_name="edit_verifications",
        schema="coord",
    )
    op.drop_index(
        "idx_edit_verifications_repo",
        table_name="edit_verifications",
        schema="coord",
    )
    op.drop_index(
        "idx_edit_verifications_correlation_id",
        table_name="edit_verifications",
        schema="coord",
    )
    op.drop_table("edit_verifications", schema="coord")

    op.drop_index(
        "idx_fs_observations_observed_at",
        table_name="fs_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_fs_observations_repo_path",
        table_name="fs_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_fs_observations_correlation_id",
        table_name="fs_observations",
        schema="coord",
    )
    op.drop_table("fs_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_03_coord_dependency_observations.
_ = _COMPOSED_OUTCOMES
