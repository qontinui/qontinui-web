"""twin 07 coord metrics 2b — make 3 residual coord gauges DB-derivable

Revision ID: twin_07_coord_metrics_2b_tables
Revises: coord_commit_lineage
Create Date: 2026-06-07

Stands up the schema slice that lets coord recompute three residual
process-local metric gauges from the DB per-replica (so they survive a
replica restart / scale-out instead of resetting):

1. ``coord.origin_resolution_observations`` — Φ_OriginResolution observation
   oplog (the DNS/origin twin that pairs with ``route_serving_observations``;
   see ``twin_06_coord_route_serving_observations``). Latest-per
   ``(domain, path)`` reads via ``DISTINCT ON (domain, path)`` back the
   ``coord_origin_resolution_*`` coverage/drift gauges. Same column-style,
   server_defaults, and index idiom as the route-serving twin.

2. ``coord.primary_trees.parked_merged BOOLEAN NULL`` — backfilled by the
   stale-WIP / staleness watcher; NULL = not-yet-resolved. Lets the
   parked-but-merged primary-tree gauge be DB-derived rather than held in
   process memory.

3. ``coord.deploy_safety_posterior`` — a tiny append-only log the
   deploy-safety resolver writes the resolved posterior to, so
   ``coord_deploy_safety_confidence`` is readable as the latest row.

Additive / forward-only; ``coord.*`` is authored EXCLUSIVELY by this alembic
chain (the coord crate only SELECTs/INSERTs). Chains off the current single
head ``coord_commit_lineage`` (verified via ``python -m alembic heads`` on
origin/main 2026-06-07).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_07_coord_metrics_2b_tables"
down_revision: str = "coord_commit_lineage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed origin-resolution drift classifications — these are the coord-side
# ``OriginResolutionDriftClass`` enum's ``as_str()`` values and MUST match the
# Rust enum exactly. Keep in sync with the coord-side Φ_OriginResolution
# classifier (built against this same contract).
_DRIFT_CLASSES = (
    "none",
    "wrong_origin",
    "404",
    "unconfigured",
    "benign_add",
    "unknown",
)


def upgrade() -> None:
    op.create_table(
        "origin_resolution_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The probed app/domain key, e.g. 'app.qontinui.io'.
        sa.Column("domain", sa.Text(), nullable=False),
        # The route/path probed, e.g. '/co-pilot'.
        sa.Column("path", sa.Text(), nullable=False),
        # The origin that actually served the route; NULL if unresolved.
        sa.Column("origin", sa.Text(), nullable=True),
        # Which app the served origin maps to; NULL if unknown.
        sa.Column("serves_what_app", sa.Text(), nullable=True),
        # The observed HTTP status code; NULL if the probe failed/unreachable.
        sa.Column("http_status", sa.Integer(), nullable=True),
        # Whether the resolution matched the declared intent.
        sa.Column("is_intended", sa.Boolean(), nullable=True),
        sa.Column("drift_class", sa.Text(), nullable=False),
        # The declared/expected origin for this (domain, path); NULL if none.
        sa.Column("expected_origin", sa.Text(), nullable=True),
        # The declared/expected app for this (domain, path); NULL if none.
        sa.Column("expected_app", sa.Text(), nullable=True),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # D6 credibility in [0,1]; NULL when not scored.
        sa.Column("credibility", sa.Float(precision=53), nullable=True),
        # Observer identity, e.g. 'coord_origin_resolution_observer_http_probe'.
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "drift_class IN ('none','wrong_origin','404','unconfigured',"
            "'benign_add','unknown')",
            name="origin_resolution_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Latest-per-route lookup: DISTINCT ON (domain, path) ORDER BY
    # domain, path, observed_at DESC.
    op.create_index(
        "idx_origin_resolution_observations_domain_path_observed_at",
        "origin_resolution_observations",
        ["domain", "path", sa.text("observed_at DESC")],
        schema="coord",
    )

    # ALTER coord.primary_trees: backfilled by the staleness watcher; NULL =
    # not-yet-resolved.
    op.add_column(
        "primary_trees",
        sa.Column("parked_merged", sa.Boolean(), nullable=True),
        schema="coord",
    )

    op.create_table(
        "deploy_safety_posterior",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The composite health+log+release scope key the posterior is over.
        sa.Column("drift_scope", sa.Text(), nullable=False),
        # Resolved posterior mean for coord_deploy_safety_confidence.
        sa.Column("posterior_mean", sa.Float(precision=53), nullable=False),
        schema="coord",
    )

    # Render reads the latest row: ORDER BY observed_at DESC LIMIT 1.
    op.create_index(
        "idx_deploy_safety_posterior_observed_at",
        "deploy_safety_posterior",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_deploy_safety_posterior_observed_at",
        table_name="deploy_safety_posterior",
        schema="coord",
    )
    op.drop_table("deploy_safety_posterior", schema="coord")

    op.drop_column("primary_trees", "parked_merged", schema="coord")

    op.drop_index(
        "idx_origin_resolution_observations_domain_path_observed_at",
        table_name="origin_resolution_observations",
        schema="coord",
    )
    op.drop_table("origin_resolution_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_06_coord_route_serving_observations.
_ = _DRIFT_CLASSES
