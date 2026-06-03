"""twin 06 coord.route_serving_observations — Φ_RouteServing observation oplog

Revision ID: twin_06_coord_route_serving_observations
Revises: merge_06_commit_effect_restack_heads
Create Date: 2026-06-03

Expand half of the Ξ_Routing → **Ξ_RouteServing** rename (follow-up #5 of
``plans/2026-05-31-twin-routing-layer.md``; descriptive-naming pass that
disambiguates the route-*serving* twin from the Ξ_Route → Ξ_OriginResolution
DNS/origin twin). Same shape as ``twin_05_coord_routing_drift_observations``
under the new name; coord's ``route_serving_observer`` (renamed from
``routing_observer``) switches its INSERT/SELECT and boot ``require_table``
target to this table in the paired coord PR.

**Expand/contract — deliberately NOT an in-place ``ALTER TABLE RENAME``:** the
currently-deployed coord writes ``routing_drift_observations`` and boot-asserts
it via ``require_table``; an in-place rename would crash-loop any coord restart
in the window between this migration applying and the renamed coord deploying.
Creating the new table alongside is zero-risk; the old
``coord.routing_drift_observations`` (hours of disposable oplog rows) is
dropped in a later contract migration (tracked in
``plans/2026-06-03-route-serving-external-surfaces.md``).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_06_coord_route_serving_observations"
down_revision: str = "merge_06_commit_effect_restack_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — these are the coord-side
# ``RouteServingDriftClass`` enum's ``as_str()`` values and MUST match the Rust
# enum exactly. Keep in sync with the coord-side Φ_RouteServing classifier
# (built against this same contract).
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
        "route_serving_observations",
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
        # Observer identity, e.g. 'coord_route_serving_observer_http_probe'.
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
            server_default=sa.text("'coord_route_serving_observer'"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','pending','shadow_route','status_drift',"
            "'route_missing','divergent','unknown')",
            name="route_serving_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_route_serving_observations_observed_at",
        "route_serving_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )

    # Latest-per-route lookups by (host, route_path).
    op.create_index(
        "idx_route_serving_observations_host_path",
        "route_serving_observations",
        ["host", "route_path"],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_route_serving_observations_host_path",
        table_name="route_serving_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_route_serving_observations_observed_at",
        table_name="route_serving_observations",
        schema="coord",
    )
    op.drop_table("route_serving_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_03_coord_release_observations.
_ = _DRIFT_CLASSES
