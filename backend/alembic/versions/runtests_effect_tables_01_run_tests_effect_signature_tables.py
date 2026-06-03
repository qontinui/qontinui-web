"""run-tests effect-signature tables (coord.* — Phases 1-3)

Revision ID: runtests_effect_tables_01
Revises: twin_08_coord_twin_targets
Create Date: 2026-06-03

Stands up the 4 ``coord.*`` tables backing the run-tests effect-signature
plan. They mirror the posture of ``coord.fs_observations`` /
``coord.edit_verifications`` (``src/edit_effects.rs``): append-only / cache
oplogs, **best-effort** writes, **no ``require_table`` boot guard** (coord
stays bootable before this migration applies), nullable ``tenant_id``,
``provenance`` + numeric columns.

The ``coord.*`` schema is alembic's SOLE author; the coord Rust persistence
keeps DDL only under ``#[cfg(test)]``. This file is the single source of
truth — the coord Rust code MUST agree column-for-column. Canonical DDL spec:
``D:/qontinui-root/_scratch/run-tests-ddl-spec.md``.

Tables:

* ``coord.test_run_signatures``    — Phase 1.1, declare oplog, append-only.
* ``coord.test_coverage_map``      — Phase 1.3, per-test file coverage, upsert
  keyed ``(repo, head_sha, test_id)``; ``files_touched`` GIN-indexed.
* ``coord.test_results``           — Phase 2.1, per-test outcome oplog,
  append-only; ``outcome`` + ``source`` CHECK-constrained.
* ``coord.test_credibility_priors``— Phase 3.1, per-test credibility cache,
  upsert keyed ``(repo, test_id)``.

Idempotency: each ``create_table`` is guarded individually by
``sa.inspect(bind).has_table(...)`` so a partial / out-of-band prior apply
of any subset is a no-op for that table.

Chains off ``twin_08_coord_twin_targets`` — the verified single head of the
alembic graph at authoring time — so the graph does NOT fork.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "runtests_effect_tables_01"
# CRITICAL: chain off the current single head so the alembic graph does NOT
# fork. twin_08_coord_twin_targets is the verified head at authoring time.
down_revision: str = "twin_08_coord_twin_targets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ---------------------------------------------------------------
    # 1. coord.test_run_signatures  (Phase 1.1 — declare oplog)
    # ---------------------------------------------------------------
    if not inspector.has_table("test_run_signatures", schema="coord"):
        op.create_table(
            "test_run_signatures",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("repo", sa.Text(), nullable=False),
            sa.Column("test_command", sa.Text(), nullable=False),
            sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("triggered_by", sa.Text(), nullable=False),
            sa.Column("head_sha", sa.Text(), nullable=True),
            sa.Column(
                "predicted", postgresql.JSONB(astext_type=sa.Text()), nullable=False
            ),
            sa.Column("provenance", sa.Text(), nullable=False),
            sa.Column(
                "coverage",
                sa.Float(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column(
                "declared_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.CheckConstraint(
                "triggered_by IN ('ci','local','agent')",
                name="ck_test_run_signatures_triggered_by",
            ),
            sa.PrimaryKeyConstraint("id"),
            schema="coord",
        )
        op.create_index(
            "idx_test_run_signatures_correlation",
            "test_run_signatures",
            ["correlation_id"],
            schema="coord",
            postgresql_where=sa.text("correlation_id IS NOT NULL"),
        )
        op.create_index(
            "idx_test_run_signatures_repo_head",
            "test_run_signatures",
            ["repo", "head_sha"],
            schema="coord",
        )
        op.create_index(
            "idx_test_run_signatures_declared_at",
            "test_run_signatures",
            ["declared_at"],
            schema="coord",
        )

    # ---------------------------------------------------------------
    # 2. coord.test_coverage_map  (Phase 1.3 — per-test file coverage)
    # ---------------------------------------------------------------
    if not inspector.has_table("test_coverage_map", schema="coord"):
        op.create_table(
            "test_coverage_map",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("repo", sa.Text(), nullable=False),
            sa.Column("head_sha", sa.Text(), nullable=False),
            sa.Column("test_id", sa.Text(), nullable=False),
            sa.Column(
                "files_touched",
                postgresql.ARRAY(sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
            sa.Column("lines_covered", sa.Integer(), nullable=True),
            sa.Column("coverage_kind", sa.Text(), nullable=True),
            sa.Column("provenance", sa.Text(), nullable=False),
            sa.Column(
                "observed_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "repo",
                "head_sha",
                "test_id",
                name="uq_test_coverage_map_repo_head_test",
            ),
            schema="coord",
        )
        op.create_index(
            "idx_test_coverage_map_files_touched",
            "test_coverage_map",
            ["files_touched"],
            schema="coord",
            postgresql_using="gin",
        )
        op.create_index(
            "idx_test_coverage_map_repo_head",
            "test_coverage_map",
            ["repo", "head_sha"],
            schema="coord",
        )
        op.create_index(
            "idx_test_coverage_map_observed_at",
            "test_coverage_map",
            ["observed_at"],
            schema="coord",
        )

    # ---------------------------------------------------------------
    # 3. coord.test_results  (Phase 2.1 — per-test outcome oplog)
    # ---------------------------------------------------------------
    if not inspector.has_table("test_results", schema="coord"):
        op.create_table(
            "test_results",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("repo", sa.Text(), nullable=False),
            sa.Column("head_sha", sa.Text(), nullable=True),
            sa.Column("test_id", sa.Text(), nullable=False),
            sa.Column("outcome", sa.Text(), nullable=False),
            sa.Column("duration_seconds", sa.Float(), nullable=True),
            sa.Column("shard", sa.Text(), nullable=True),
            sa.Column(
                "source",
                sa.Text(),
                nullable=False,
                server_default=sa.text("'ci'"),
            ),
            sa.Column("provenance", sa.Text(), nullable=False),
            sa.Column(
                "observed_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.CheckConstraint(
                "outcome IN ('pass','fail','skip','error','unknown')",
                name="ck_test_results_outcome",
            ),
            sa.CheckConstraint(
                "source IN ('ci','local','sandboxed','agent')",
                name="ck_test_results_source",
            ),
            sa.PrimaryKeyConstraint("id"),
            schema="coord",
        )
        op.create_index(
            "idx_test_results_repo_test",
            "test_results",
            ["repo", "test_id"],
            schema="coord",
        )
        op.create_index(
            "idx_test_results_correlation",
            "test_results",
            ["correlation_id"],
            schema="coord",
            postgresql_where=sa.text("correlation_id IS NOT NULL"),
        )
        op.create_index(
            "idx_test_results_repo_head",
            "test_results",
            ["repo", "head_sha"],
            schema="coord",
        )
        op.create_index(
            "idx_test_results_observed_at",
            "test_results",
            ["observed_at"],
            schema="coord",
        )

    # ---------------------------------------------------------------
    # 4. coord.test_credibility_priors  (Phase 3.1 — credibility cache)
    # ---------------------------------------------------------------
    if not inspector.has_table("test_credibility_priors", schema="coord"):
        op.create_table(
            "test_credibility_priors",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("repo", sa.Text(), nullable=False),
            sa.Column("test_id", sa.Text(), nullable=False),
            sa.Column("authorship_independence", sa.Float(), nullable=False),
            sa.Column("tooling_independence", sa.Float(), nullable=False),
            sa.Column("data_independence", sa.Float(), nullable=False),
            sa.Column("credibility", sa.Float(), nullable=False),
            sa.Column(
                "aggregation",
                sa.Text(),
                nullable=False,
                server_default=sa.text("'geometric_mean'"),
            ),
            sa.Column("test_source_sha", sa.Text(), nullable=True),
            sa.Column("tooling_fingerprint", sa.Text(), nullable=True),
            sa.Column("provenance", sa.Text(), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.CheckConstraint(
                "aggregation IN ('geometric_mean','worst_axis')",
                name="ck_test_credibility_priors_aggregation",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "repo",
                "test_id",
                name="uq_test_credibility_priors_repo_test",
            ),
            schema="coord",
        )
        op.create_index(
            "idx_test_credibility_priors_updated_at",
            "test_credibility_priors",
            ["updated_at"],
            schema="coord",
        )


def downgrade() -> None:
    # 4. test_credibility_priors
    op.execute("DROP INDEX IF EXISTS coord.idx_test_credibility_priors_updated_at")
    op.drop_table("test_credibility_priors", schema="coord")

    # 3. test_results
    op.execute("DROP INDEX IF EXISTS coord.idx_test_results_observed_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_results_repo_head")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_results_correlation")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_results_repo_test")
    op.drop_table("test_results", schema="coord")

    # 2. test_coverage_map
    op.execute("DROP INDEX IF EXISTS coord.idx_test_coverage_map_observed_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_coverage_map_repo_head")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_coverage_map_files_touched")
    op.drop_table("test_coverage_map", schema="coord")

    # 1. test_run_signatures
    op.execute("DROP INDEX IF EXISTS coord.idx_test_run_signatures_declared_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_run_signatures_repo_head")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_run_signatures_correlation")
    op.drop_table("test_run_signatures", schema="coord")
