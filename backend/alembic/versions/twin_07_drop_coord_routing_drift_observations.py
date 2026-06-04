"""twin 07 DROP coord.routing_drift_observations — Ξ_Routing→Ξ_RouteServing contract

Revision ID: twin_07_drop_coord_routing_drift_observations
Revises: twin_06_coord_route_serving_observations
Create Date: 2026-06-04

**Contract half** of the Ξ_Routing → **Ξ_RouteServing** rename (the
expand/contract pair whose expand half is
``twin_06_coord_route_serving_observations``; see follow-up #5 of
``plans/2026-05-31-twin-routing-layer.md`` and
``plans/2026-06-03-route-serving-external-surfaces.md``).

twin_06 created the new ``coord.route_serving_observations`` table *alongside*
the old ``coord.routing_drift_observations`` rather than renaming in place, so
that a coord restart in the deploy window could never crash-loop on a missing
boot-asserted (``require_table``) table. That window is now closed: the renamed
coord binary (``route_serving_observer``, formerly ``routing_observer``) is
**LIVE in prod** writing/SELECTing ``coord.route_serving_observations`` and
boot-asserting *that* table — confirmed via prod route-serving metrics. Nothing
reads or writes the old ``coord.routing_drift_observations`` anymore; its
contents were hours of disposable observation-oplog rows.

This migration therefore drops the now-superseded
``coord.routing_drift_observations`` table (and its two indexes). The drop is
safe per that deploy. ``downgrade()`` fully recreates the table exactly as
``twin_05_coord_routing_drift_observations`` defined it (columns, the
``routing_drift_observations_drift_class_chk`` CHECK constraint, and both
indexes) so the migration is reversible.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_07_drop_coord_routing_drift_observations"
down_revision: str = "twin_06_coord_route_serving_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — these are the (legacy) coord-side
# ``RoutingDriftClass`` enum's ``as_str()`` values. Retained here only so
# ``downgrade()`` recreates the old table's CHECK constraint identically to
# ``twin_05_coord_routing_drift_observations``.
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
    # Drop the indexes first, then the table. The new
    # ``coord.route_serving_observations`` (twin_06) fully supersedes this one.
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


def downgrade() -> None:
    # Recreate ``coord.routing_drift_observations`` exactly as
    # ``twin_05_coord_routing_drift_observations`` originally created it.
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


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_05_coord_routing_drift_observations.
_ = _DRIFT_CLASSES
