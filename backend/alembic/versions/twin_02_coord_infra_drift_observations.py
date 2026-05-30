"""twin 02 coord.infra_drift_observations — Φ_Infra observation oplog

Revision ID: twin_02_coord_infra_drift_observations
Revises: twin_01_coord_migration_observations
Create Date: 2026-05-30

Phase 3a of the digital-twin migrations + infra-layers plan
(``D:/qontinui-root/plans/2026-05-30-digital-twin-migrations-and-infra-layers.md``).

Creates ``coord.infra_drift_observations`` — an **append-only oplog** of the
Φ_Infra (infrastructure-drift) evaluations. Each row is one observation of the
declared-vs-actual infrastructure state: a classified drift state, whether any
*active negation* (a destructive/conflicting change vs the declared state) was
observed, the per-resource observation records, which subsystem owns the drift
(terraform-managed vs CI-managed), and the D6 observation-space confidence pair
(``coverage`` + ``credibility``, both in ``[0,1]``).

Design notes (mirrors ``twin_01_coord_migration_observations`` /
``row_9_phase_4_01_coord_alerts`` conventions):

* ``drift_class`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.migration_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. Keep the allowed set in
  sync with the coord-side Φ_Infra classifier (built against this same
  contract).
* No unique constraint — this is intentionally a history oplog; the same
  observation tuple recurs every observation tick.
* The lone index is on ``observed_at DESC``: the hot lookup is "the latest
  observation" (``ORDER BY observed_at DESC LIMIT 1``).
* ``resource_observations`` is a JSONB array of
  ``{resource,kind,expected,actual,classification}`` records — the structured
  per-resource context the drift evaluator and dashboard render.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_02_coord_infra_drift_observations"
down_revision: str = "cognito_legacy_auth_teardown_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — keep in sync with the coord-side Φ_Infra
# classifier (built against this same contract).
_DRIFT_CLASSES = (
    "ok",
    "benign_add",
    "in_place_change",
    "active_negation",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "infra_drift_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("drift_class", sa.Text(), nullable=False),
        sa.Column(
            "has_active_negation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # Array of ``{resource,kind,expected,actual,classification}`` records.
        sa.Column(
            "resource_observations",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "terraform_owned_drift",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "ci_owned_drift",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        # Observer identity, e.g. ``'aws_sdk_describe'``.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'coord_infra_observer'"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','benign_add','in_place_change',"
            "'active_negation','unknown')",
            name="infra_drift_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_infra_drift_observations_observed_at",
        "infra_drift_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_infra_drift_observations_observed_at",
        table_name="infra_drift_observations",
        schema="coord",
    )
    op.drop_table("infra_drift_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_01_coord_migration_observations.
_ = _DRIFT_CLASSES
