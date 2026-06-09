"""twin 04 coord.infra_health_observations — Ξ_InfraHealth observation oplog

Revision ID: twin_04_coord_infra_health_observations
Revises: fleet_policy_01_coord_fleet_runtime_policy
Create Date: 2026-06-08

Phase 1 of the twin infrastructure-health & performance layer plan
(``D:/qontinui-root/plans/2026-08-twin-infrastructure-health-performance-layer.md``
— `2026-06-08-twin-infrastructure-health-performance-layer.md`).

Creates ``coord.infra_health_observations`` — an **append-only oplog** of the
Ξ_InfraHealth (infrastructure availability + performance) evaluations. Where
``coord.infra_drift_observations`` (Ξ_Infra, twin_02) tracks declared-vs-actual
*config/shape* drift, this tracks declared-SLO-vs-live-metric *behavior* of the
deployed resources coord/web depend on (RDS CloudWatch + crash/recovery events,
ALB target health + 5xx + latency, ECS task health).

Each tick writes ONE ROW PER OBSERVED RESOURCE (``resource_kind`` +
``resource_id`` are first-class columns), so the operator's O(1) ask — "what is
RDS ``qontinui-staging`` doing right now?" — is a single indexed
latest-per-resource read rather than the 8-hop manual AWS-CLI traversal the
2026-06-08 incident required. ``components`` is the JSONB per-metric breakdown
(value, threshold, breach kind, classification) backing that answer.

Design notes (mirrors ``twin_02_coord_infra_drift_observations`` /
``twin_03`` release-observations conventions):

* ``drift_class`` is TEXT + CHECK rather than a PG enum — same rationale as the
  sibling twin tables (text+CHECK evolves without ``ALTER TYPE`` acrobatics).
  Keep the allowed set in sync with the coord-side ``InfraHealthDriftClass``
  enum (``infra_health_observer.rs``), built against this same contract.
* No unique constraint — this is intentionally a history oplog; the same
  ``(resource_kind, resource_id)`` recurs every observation tick.
* The lone index is on ``(resource_kind, resource_id, observed_at DESC)``: the
  hot lookup is "the latest observation for THIS resource"
  (``... WHERE resource_kind=$1 AND resource_id=$2 ORDER BY observed_at DESC
  LIMIT 1``) and the fleet roll-up (``DISTINCT ON (resource_kind,
  resource_id)``).
* ``components`` is a JSONB array of
  ``{metric, value, threshold, breach, classification}`` records — the
  structured per-metric context the health evaluator and the
  ``coord_query_infra_health_drift`` MCP tool render.
* ``coverage`` / ``credibility`` are the D6 observation-space confidence pair
  (both in ``[0,1]``): a denied CloudWatch read lowers ``coverage`` and is
  recorded as ``unknown``, never a false ``ok``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_04_coord_infra_health_observations"
down_revision: str = "fleet_policy_01_coord_fleet_runtime_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — keep in sync with the coord-side
# ``InfraHealthDriftClass`` enum (``infra_health_observer.rs``), built against
# this same contract.
_DRIFT_CLASSES = (
    "ok",
    "degraded",
    "unavailable",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "infra_health_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The observed resource: kind (`rds` / `alb` / `ecs`) + its id
        # (instance identifier / target-group or service name). First-class
        # columns so "latest observation for THIS resource" is a single indexed
        # read (the O(1) lookup).
        sa.Column("resource_kind", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        # Worst classification across this resource's evaluated metrics.
        sa.Column("drift_class", sa.Text(), nullable=False),
        # D6 coverage in [0,1] — fraction of this resource's intended metrics
        # successfully read this tick.
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        # Observer identity, e.g. ``'aws_sdk_cloudwatch'``.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        # Array of ``{metric, value, threshold, breach, classification}`` records.
        sa.Column(
            "components",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'coord_infra_health_observer'"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','degraded','unavailable','unknown')",
            name="infra_health_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation for a given resource, and the fleet
    # roll-up (DISTINCT ON (resource_kind, resource_id) ... ORDER BY
    # resource_kind, resource_id, observed_at DESC).
    op.create_index(
        "idx_infra_health_observations_resource_observed_at",
        "infra_health_observations",
        ["resource_kind", "resource_id", sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_infra_health_observations_resource_observed_at",
        table_name="infra_health_observations",
        schema="coord",
    )
    op.drop_table("infra_health_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_02_coord_infra_drift_observations.
_ = _DRIFT_CLASSES
