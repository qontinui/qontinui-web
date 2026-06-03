"""twin 05 coord.routing_drift_observations — Φ_Routing observation oplog

Revision ID: twin_05_coord_routing_drift_observations
Revises: agent_tool_access_01
Create Date: 2026-06-03

Phase 1 of the digital-twin Routing layer plan
(``D:/qontinui-root/plans/2026-05-31-twin-routing-layer.md``) — the
**predict-effect-less** routing instance (the twin observes declared-vs-actual
route state; it does not predict effects of mutating it).

Creates ``coord.routing_drift_observations`` — an **append-only oplog** of the
Φ_Routing (declared-vs-actual route) evaluations. Each row is one observation
of a probed route on a host: the declared status class, the actually-observed
HTTP status code, whether the route served at all (any status, incl.
401/403), and a classified drift state. The D6 ``coverage`` / ``credibility``
columns carry the observation-space confidence pair (both in ``[0,1]``).

Design notes (mirrors ``twin_03_coord_release_observations`` /
``twin_02_coord_infra_drift_observations`` conventions):

* ``drift_class`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.release_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. The allowed set is the
  7-token routing persistence enum; these are the coord-side
  ``RoutingDriftClass`` enum's ``as_str()`` values and MUST match the Rust
  enum exactly. Keep the allowed set in sync with the coord-side Φ_Routing
  classifier (built against this same contract).
* No unique constraint — this is intentionally a history oplog; the same
  ``(host, route_path, drift_class, …)`` tuple recurs every observation tick.
* Two indexes: ``observed_at DESC`` for the hot "latest observation"
  (``ORDER BY observed_at DESC LIMIT 1``) lookup, and a btree on
  ``(host, route_path)`` for latest-per-route lookups.
* ``actual_status`` is NULL when the probe failed/was unreachable (no HTTP
  status was observed); ``served`` records whether the route responded at all.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_05_coord_routing_drift_observations"
down_revision: str = "agent_tool_access_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — these are the coord-side ``RoutingDriftClass``
# enum's ``as_str()`` values and MUST match the Rust enum exactly. Keep in sync
# with the coord-side Φ_Routing classifier (built against this same contract).
_DRIFT_CLASSES = (
    "ok",
    "pending",
    "shadow_route",
    "status_drift",
    "route_missing",
    "divergent",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "routing_drift_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The probed host, e.g. 'coord.qontinui.io'.
        sa.Column("host", sa.Text(), nullable=False),
        # The declared/probed path, e.g. '/coord/status'.
        sa.Column("route_path", sa.Text(), nullable=False),
        # Expected status class: '2xx' | '3xx' | '4xx' | 'auth' | 'dynamic'.
        # NULL when no declared expectation is available.
        sa.Column("declared_status_class", sa.Text(), nullable=True),
        # The observed HTTP status code; NULL if the probe failed/unreachable.
        sa.Column("actual_status", sa.Integer(), nullable=True),
        # Whether the route responded at all (any status, incl. 401/403).
        sa.Column(
            "served",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("drift_class", sa.Text(), nullable=False),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Observer identity, e.g. 'coord_routing_observer_http_probe'.
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
            server_default=sa.text("'coord_routing_observer'"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','pending','shadow_route','status_drift',"
            "'route_missing','divergent','unknown')",
            name="routing_drift_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_routing_drift_observations_observed_at",
        "routing_drift_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )

    # Latest-per-route lookups by (host, route_path).
    op.create_index(
        "idx_routing_drift_observations_host_path",
        "routing_drift_observations",
        ["host", "route_path"],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_routing_drift_observations_host_path",
        table_name="routing_drift_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_routing_drift_observations_observed_at",
        table_name="routing_drift_observations",
        schema="coord",
    )
    op.drop_table("routing_drift_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_03_coord_release_observations.
_ = _DRIFT_CLASSES
