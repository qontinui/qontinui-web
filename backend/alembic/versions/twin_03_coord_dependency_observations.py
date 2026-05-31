"""twin 03 coord.dependency_observations — Φ_Dependencies (cheap) observation oplog

Revision ID: twin_03_coord_dependency_observations
Revises: twin_02_coord_infra_drift_observations
Create Date: 2026-05-30

Phase 4 of the twin dependencies layer plan
(``D:/qontinui-root/plans/2026-05-30-twin-dependencies-layer.md``, §4).

Creates ``coord.dependency_observations`` — an **append-only oplog** of the
CHEAP, compute-on-pull Φ_Dependencies evaluations. Each row is one observation
of the declared↔installed↔sibling dependency state for one workspace member of
one ecosystem: the declared version ranges, the installed versions, the lockfile
hash + staleness flag, the set of installs that fall outside the declared ranges,
the sibling ranges that would need widening, and a classified drift state. The
D6 ``coverage`` / ``credibility`` columns carry the observation-space confidence
pair (both in ``[0,1]``).

Design notes (mirrors ``twin_01_coord_migration_observations`` /
``twin_02_coord_infra_drift_observations`` conventions):

* ``drift_class`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.migration_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. Keep the allowed set in
  sync with the coord-side Φ_Dependencies classifier (built against this same
  contract).
* No unique constraint — this is intentionally a history oplog; the same
  observation tuple recurs every observation tick.
* The lone index is on ``observed_at DESC``: the hot lookup is "the latest
  observation" (``ORDER BY observed_at DESC LIMIT 1``).
* ``workspace_member`` is the package/crate/dist name, or ``'__workspace__'``
  for workspace-level facts.
* ``declared_ranges`` / ``installed_versions`` are JSONB objects keyed by dep
  name; ``installed_outside_declared`` / ``sibling_widening_required`` are JSONB
  arrays — the structured context the drift evaluator and dashboard render.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_03_coord_dependency_observations"
down_revision: str = "twin_02_coord_infra_drift_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — keep in sync with the coord-side
# Φ_Dependencies classifier (built against this same contract).
_DRIFT_CLASSES = (
    "ok",
    "installed_outside_declared",
    "lock_stale",
    "node_modules_drift",
    "sibling_widening",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "dependency_observations",
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
        # Object keyed by dep name → declared version range.
        sa.Column(
            "declared_ranges",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # Object keyed by dep name → installed version.
        sa.Column(
            "installed_versions",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("lock_hash", sa.Text(), nullable=True),
        sa.Column(
            "lock_stale",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # Array of installs that fall outside the declared ranges.
        sa.Column(
            "installed_outside_declared",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Array of sibling ranges that would need widening.
        sa.Column(
            "sibling_widening_required",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("drift_class", sa.Text(), nullable=False),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Observer identity, e.g. ``'coord_dependency_observer'``.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','installed_outside_declared','lock_stale',"
            "'node_modules_drift','sibling_widening','unknown')",
            name="dependency_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_dependency_observations_observed_at",
        "dependency_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_dependency_observations_observed_at",
        table_name="dependency_observations",
        schema="coord",
    )
    op.drop_table("dependency_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_02_coord_infra_drift_observations.
_ = _DRIFT_CLASSES
