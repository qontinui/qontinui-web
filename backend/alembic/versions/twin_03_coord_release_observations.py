"""twin 03 coord.release_observations — Φ_Release observation oplog

Revision ID: twin_03_coord_release_observations
Revises: cognito_legacy_auth_teardown_02
Create Date: 2026-05-31

Phase 2a of the digital-twin Release/Deploy-freshness plan
(``D:/qontinui-root/plans/2026-05-30-twin-release-deploy-freshness-layer.md``
§4.1).

Creates ``coord.release_observations`` — an **append-only oplog** of the
Φ_Release (release/deploy-freshness) evaluations. Each row is one observation
of the declared-vs-actual deployment state across release surfaces (ECS,
Vercel, npm): the declared SHA, the deployed SHA/digest/version, whether the
surface is in sync, the elapsed lag, and a classified drift state. The D6
``coverage`` / ``credibility`` columns carry the observation-space confidence
pair (both in ``[0,1]``).

Design notes (mirrors ``twin_01_coord_migration_observations`` /
``twin_02_coord_infra_drift_observations`` conventions):

* ``drift_class`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.infra_drift_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. The allowed set is the
  release-specific 6-class persistence enum; coord maps it to the canonical
  taxonomy at the MCP query boundary. Keep the allowed set in sync with the
  coord-side Φ_Release classifier (built against this same contract).
* No unique constraint — this is intentionally a history oplog; the same
  ``(surface, target, drift_class, …)`` tuple recurs every observation tick.
* The lone index is on ``observed_at DESC``: the hot lookup is "the latest
  observation" (``ORDER BY observed_at DESC LIMIT 1``).
* ``lag_seconds`` is NULL when the surface is in-sync or in-flight (no
  meaningful lag to report); non-NULL when stale/rolled_back/failed_deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_03_coord_release_observations"
down_revision: str = "cognito_legacy_auth_teardown_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — keep in sync with the coord-side Φ_Release
# classifier (built against this same contract).
_DRIFT_CLASSES = (
    "in_sync",
    "in_flight",
    "stale",
    "rolled_back",
    "failed_deploy",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "release_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Release surface: 'ecs' | 'vercel' | 'npm'.
        sa.Column("surface", sa.Text(), nullable=False),
        # Human-readable target, e.g. 'qontinui-staging/coord', 'qontinui-web',
        # '@qontinui/ui-bridge'.
        sa.Column("target", sa.Text(), nullable=False),
        # Source repository, e.g. 'qontinui/qontinui-coord'. NULL when not
        # applicable (e.g. third-party npm package).
        sa.Column("repo", sa.Text(), nullable=True),
        # The declared (expected) SHA — from the coord Git ref, CI artifact, or
        # package.json, depending on surface.
        sa.Column("declared_sha", sa.Text(), nullable=True),
        # The actually-deployed identifier: running image digest / deployed
        # commit SHA / published npm version.
        sa.Column("deployed_sha", sa.Text(), nullable=True),
        sa.Column(
            "in_sync",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # NULL when in-sync or in-flight; elapsed seconds when stale/rolled_back/
        # failed_deploy.
        sa.Column("lag_seconds", sa.BigInteger(), nullable=True),
        sa.Column("drift_class", sa.Text(), nullable=False),
        # Free-form outcome from the deploy pipeline, e.g. 'success', 'timeout',
        # 'rollback'. NULL when no pipeline outcome is available.
        sa.Column("deploy_outcome", sa.Text(), nullable=True),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Observer identity, e.g. 'ecs_sdk_describe_tasks'.
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
            server_default=sa.text("'coord_release_observer'"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('in_sync','in_flight','stale',"
            "'rolled_back','failed_deploy','unknown')",
            name="release_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_release_observations_observed_at",
        "release_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_release_observations_observed_at",
        table_name="release_observations",
        schema="coord",
    )
    op.drop_table("release_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_02_coord_infra_drift_observations.
_ = _DRIFT_CLASSES
