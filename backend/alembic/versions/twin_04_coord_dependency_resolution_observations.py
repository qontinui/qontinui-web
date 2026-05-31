"""twin 04 coord.dependency_resolution_observations — Φ_Dependencies (async) oplog

Revision ID: twin_04_coord_dependency_resolution_observations
Revises: twin_03_coord_dependency_observations
Create Date: 2026-05-30

Phase 4 of the twin dependencies layer plan
(``D:/qontinui-root/plans/2026-05-30-twin-dependencies-layer.md``, §4).

Creates ``coord.dependency_resolution_observations`` — an **append-only oplog**
of the ASYNC resolver + registry Φ_Dependencies facts. Each row is one
observation of the resolvability + publish state for one workspace member of one
ecosystem: whether a full resolve would ERESOLVE (with detail), which published
versions are missing or yanked, whether the target tag is already published, and
when the registry was checked. The D6 ``coverage`` / ``credibility`` columns
carry the observation-space confidence pair (both in ``[0,1]``).

Design notes (mirrors ``twin_03_coord_dependency_observations`` /
``twin_01_coord_migration_observations`` conventions):

* No unique constraint — this is intentionally a history oplog; the same
  observation tuple recurs every observation tick.
* The lone index is on ``observed_at DESC``: the hot lookup is "the latest
  observation" (``ORDER BY observed_at DESC LIMIT 1``).
* ``workspace_member`` is the package/crate/dist name, or ``'__workspace__'``
  for workspace-level facts.
* ``eresolve_detail`` is a JSONB object; ``published_missing`` /
  ``published_yanked`` are JSONB arrays — the structured context the resolver
  evaluator and dashboard render.
* ``source_run_id`` ties an async observation back to the CI/resolver run that
  produced it (registry probes are async + can lag the cheap observation).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_04_coord_dependency_resolution_observations"
down_revision: str = "twin_03_coord_dependency_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dependency_resolution_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # e.g. 'npm','cargo','pip'.
        sa.Column("ecosystem", sa.Text(), nullable=False),
        # The package/crate/dist name, or '__workspace__' for workspace-level facts.
        sa.Column("workspace_member", sa.Text(), nullable=False),
        sa.Column(
            "would_eresolve",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # Object describing the ERESOLVE conflict, when one is observed.
        sa.Column(
            "eresolve_detail",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # Array of declared deps that are missing from the registry.
        sa.Column(
            "published_missing",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Array of declared deps that resolve to a yanked published version.
        sa.Column(
            "published_yanked",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "tag_already_published",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("registry_checked_at", sa.DateTime(timezone=True), nullable=True),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        # Observer identity, e.g. ``'coord_dependency_resolver'``.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        # Ties this async observation back to the CI/resolver run that produced it.
        sa.Column("source_run_id", sa.Text(), nullable=True),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_dependency_resolution_observations_observed_at",
        "dependency_resolution_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_dependency_resolution_observations_observed_at",
        table_name="dependency_resolution_observations",
        schema="coord",
    )
    op.drop_table("dependency_resolution_observations", schema="coord")
