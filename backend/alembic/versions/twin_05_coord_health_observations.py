"""twin 05 coord.health_observations — Ξ_Health observation oplog

Revision ID: twin_05_coord_health_observations
Revises: edit_effect_01_coord_edit_effect_tables
Create Date: 2026-06-02

Phase 2 of the digital-twin Runtime Health & Error/Log layer plan
(``D:/qontinui-root/plans/2026-05-31-twin-health-and-log-layer.md`` §3).

Creates ``coord.health_observations`` — an **append-only oplog** of the
per-surface Ξ_Health (runtime readiness / liveness / leader / replica-sync)
evaluations. Each row is one observation of a running surface's self-health
(coord-prod, web-prod, …): its ``/health`` subsystem liveness bools, whether it
is ``/ready``, the coord-only write-serving + replica-sync + leader-count, the
thin declared-side ``expected_ready`` projection, and a classified health
state. The D6 ``coverage`` / ``credibility`` columns carry the
observation-space confidence pair (both in ``[0,1]``).

Design notes (mirrors ``twin_03_coord_release_observations`` conventions):

* ``health_class`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.release_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. The allowed set is the
  health-specific persistence enum; coord maps it to the canonical
  declared-vs-actual taxonomy at the MCP query boundary. Keep the allowed set
  in sync with the coord-side ``health_observer`` classifier (built against
  this same contract).
* The **down=blind-spot** invariant (plan §1.3) is load-bearing: a probe
  timeout / connection-refused is ``health_class='blind'`` with ``coverage<1``
  — NEVER ``'ok'`` and never a confident ``'down'``. ``'down'`` is reserved for
  a surface we positively observed as not-serving while reachable.
* No unique constraint — this is intentionally a history oplog; the same
  ``(surface, health_class, …)`` tuple recurs every observation tick.
* Two indexes: ``observed_at DESC`` (the trend lookup) and
  ``(surface, observed_at DESC)`` (the hot query — the latest row per surface,
  used for the blind-fallback last-known answer).
* ``liveness`` is JSONB holding the ``{pg, redis, jetstream}`` subsystem bools;
  ``write_serving_ready`` / ``replicas_in_sync`` / ``leader_count`` are
  coord-only (NULL for web-prod, which has no leader/replica concept).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_05_coord_health_observations"
down_revision: str = "edit_effect_01_coord_edit_effect_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed health classifications — keep in sync with the coord-side
# ``health_observer`` HealthClass classifier (built against this same contract).
_HEALTH_CLASSES = (
    "ok",
    "degraded",
    "down",
    "blind",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "health_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Health surface: 'coord-prod' | 'web-prod' | (composed) 'fleet' / 'nats'.
        sa.Column("surface", sa.Text(), nullable=False),
        # /ready true (coord) or /health overall-ok (web). The aggregate up bit.
        sa.Column(
            "ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # The {pg, redis, jetstream} subsystem liveness bools from /health.
        # NULL when the probe was blind (couldn't read the body at all).
        sa.Column("liveness", postgresql.JSONB(), nullable=True),
        # Coord-only: write_serving_ready (the leader can serve writes). NULL for
        # web-prod (no write-plane / leader concept).
        sa.Column("write_serving_ready", sa.Boolean(), nullable=True),
        # Coord-only: replicas caught up to the durable ack-frontier. NULL for
        # web-prod.
        sa.Column("replicas_in_sync", sa.Integer(), nullable=True),
        # Coord-only: cluster-summed leader count (scraped from the
        # coord_leader_count / coord_active_leaders gauge; must be exactly 1).
        # NULL for web-prod.
        sa.Column("leader_count", sa.Integer(), nullable=True),
        # Thin declared side (plan §1.2): is this surface EXPECTED to be up +
        # caught-up this tick (vs an intentional drain / maintenance window).
        sa.Column(
            "expected_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("health_class", sa.Text(), nullable=False),
        # D6 coverage in [0,1]. <1 when the surface observer was blind/partial.
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Observer identity, e.g. 'coord_self_probe', 'web_self_probe',
        # 'health_observations_oplog_fallback'.
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
            server_default=sa.text("'coord_health_observer'"),
        ),
        sa.CheckConstraint(
            "health_class IN ('ok','degraded','down','blind','unknown')",
            name="health_observations_health_class_chk",
        ),
        schema="coord",
    )

    # Trend lookup: the latest observations across surfaces.
    op.create_index(
        "idx_health_observations_observed_at",
        "health_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )

    # Hot lookup: the latest observation PER surface
    # (``WHERE surface = $1 ORDER BY observed_at DESC LIMIT 1`` — the
    # blind-fallback last-known answer).
    op.create_index(
        "idx_health_observations_surface_observed_at",
        "health_observations",
        ["surface", sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_health_observations_surface_observed_at",
        table_name="health_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_health_observations_observed_at",
        table_name="health_observations",
        schema="coord",
    )
    op.drop_table("health_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_03_coord_release_observations.
_ = _HEALTH_CLASSES
