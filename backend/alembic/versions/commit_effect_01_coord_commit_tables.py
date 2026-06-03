"""commit-effect 01 coord.commit_* — commit-action effect-signature oplogs

Revision ID: commit_effect_01_coord_commit_tables
Revises: install_sig_01_coord_install_signatures
Create Date: 2026-06-03

Phase 0 (both phases' schema) backing the commit-action effect-signatures plan.

Creates three ``coord.*`` tables consumed by qontinui-coord (Rust), which
cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema (mirrors the ``edit_effect_01_coord_edit_effect_tables``
precedent: coord/Rust asserts presence, never CREATEs):

* ``coord.commit_observations`` — Phase 1, append-only observations forwarded by
  the runner ``git_watcher`` (one row per observed commit, with the commit's
  changed files + author metadata).
* ``coord.commit_signatures`` — Phase 2, declared predicted commit effects (the
  serialized ``PredictedCommitEffect`` an agent declares pre-commit).
* ``coord.commit_verifications`` — Phase 2, an append-only oplog of composed
  verdicts pairing a signature with the matched observation.

Design notes (mirrors ``edit_effect_01_coord_edit_effect_tables`` /
``twin_03_coord_dependency_observations`` conventions):

* ``composed_outcome`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.edit_verifications.composed_outcome``: text+CHECK evolves without
  ``ALTER TYPE`` acrobatics. The allowed-token set is copied verbatim from the
  existing ``coord.edit_verifications`` CHECK to keep the two D3-outcome
  contracts identical.
* No unique constraints — all three are intentionally history oplogs.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.
* The ``now()`` defaults are plain column defaults (evaluated per-row at INSERT) —
  fine; only a problem inside a partial-index predicate (none used here).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "commit_effect_01_coord_commit_tables"
down_revision: str = "install_sig_01_coord_install_signatures"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed composed outcomes — copied verbatim from the existing
# ``coord.edit_verifications`` CHECK (``edit_effect_01_coord_edit_effect_tables``)
# so the commit-action D3 contract is identical to the edit-action one. Keep in
# sync with the coord-side commit-effect composer.
_COMPOSED_OUTCOMES = (
    "confirmed",
    "surprise",
    "failure",
    "contradiction",
    "partial",
)


def upgrade() -> None:
    # --- coord.commit_observations : append-only git_watcher forwards --------
    op.create_table(
        "commit_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("agent_id", sa.Text(), nullable=True),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=False),
        # Nullable: detached-HEAD commits have no branch.
        sa.Column("branch", sa.Text(), nullable=True),
        sa.Column("head_sha", sa.Text(), nullable=False),
        sa.Column("parent_sha", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("author_name", sa.Text(), nullable=True),
        sa.Column("author_email", sa.Text(), nullable=True),
        # Array of {path, status}.
        sa.Column(
            "changed_files",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # The commit's own author timestamp.
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "provenance",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'git_watcher:runner'"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    op.create_index(
        "ix_commit_observations_repo_branch",
        "commit_observations",
        ["repo", "branch"],
        schema="coord",
    )
    op.create_index(
        "ix_commit_observations_repo_head",
        "commit_observations",
        ["repo", "head_sha"],
        schema="coord",
    )
    op.create_index(
        "ix_commit_observations_correlation",
        "commit_observations",
        ["correlation_id"],
        schema="coord",
    )

    # --- coord.commit_signatures : declared predicted effects (Phase 2) ------
    op.create_table(
        "commit_signatures",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_id", sa.Text(), nullable=True),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("branch", sa.Text(), nullable=False),
        # The agent's claimed pre-commit HEAD.
        sa.Column("parent_sha", sa.Text(), nullable=False),
        # Array of path strings.
        sa.Column(
            "paths_to_stage",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("message", sa.Text(), nullable=False),
        # The serialized PredictedCommitEffect.
        sa.Column("predicted", postgresql.JSONB(), nullable=False),
        sa.Column(
            "declared_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="coord",
    )
    op.create_index(
        "ix_commit_signatures_repo_branch_declared",
        "commit_signatures",
        ["repo", "branch", "declared_at"],
        schema="coord",
    )
    op.create_index(
        "ix_commit_signatures_correlation",
        "commit_signatures",
        ["correlation_id"],
        schema="coord",
    )

    # --- coord.commit_verifications : composed verdict oplog (Phase 2) -------
    op.create_table(
        "commit_verifications",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        # The matched commit_signatures.id (NULL for observation-only).
        sa.Column("signature_id", sa.BigInteger(), nullable=True),
        # The matched commit_observations.id.
        sa.Column("observation_id", sa.BigInteger(), nullable=True),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("branch", sa.Text(), nullable=True),
        sa.Column("composed_outcome", sa.Text(), nullable=False),
        # Array of {subspace, drift_class, outcome}.
        sa.Column(
            "subspace_verdicts",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "rationale",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column(
            "verified_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "composed_outcome IN ('confirmed','surprise','failure',"
            "'contradiction','partial')",
            name="ck_commit_verifications_composed_outcome",
        ),
        schema="coord",
    )
    op.create_index(
        "ix_commit_verifications_repo_branch",
        "commit_verifications",
        ["repo", "branch"],
        schema="coord",
    )
    op.create_index(
        "ix_commit_verifications_signature",
        "commit_verifications",
        ["signature_id"],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "ix_commit_verifications_signature",
        table_name="commit_verifications",
        schema="coord",
    )
    op.drop_index(
        "ix_commit_verifications_repo_branch",
        table_name="commit_verifications",
        schema="coord",
    )
    op.drop_table("commit_verifications", schema="coord")

    op.drop_index(
        "ix_commit_signatures_correlation",
        table_name="commit_signatures",
        schema="coord",
    )
    op.drop_index(
        "ix_commit_signatures_repo_branch_declared",
        table_name="commit_signatures",
        schema="coord",
    )
    op.drop_table("commit_signatures", schema="coord")

    op.drop_index(
        "ix_commit_observations_correlation",
        table_name="commit_observations",
        schema="coord",
    )
    op.drop_index(
        "ix_commit_observations_repo_head",
        table_name="commit_observations",
        schema="coord",
    )
    op.drop_index(
        "ix_commit_observations_repo_branch",
        table_name="commit_observations",
        schema="coord",
    )
    op.drop_table("commit_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in edit_effect_01_coord_edit_effect_tables.
_ = _COMPOSED_OUTCOMES
