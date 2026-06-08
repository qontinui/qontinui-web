"""pr_merge — per-tenant + per-repo layering merge-gate opt-in columns

Revision ID: layering_gate_cols_01
Revises: coord_maintenance_2026_06_08
Create Date: 2026-06-08

Plan 2026-06-07-coord-layering-enforcement (R4b follow-up).

Adds the layering merge-gate opt-in to the three-tier PR-merge settings
substrate (the exact parallel of ``blast_radius_gate_cols_01``). The gate
blocks auto-merge (escalates to a specialist) when a PR breaches the repo's
authored ``qontinui-layers.toml`` — a layer breach / cross-layer cycle, or an
unresolved manifest coverage gap (the ``Ξ_Layering`` verdict from coord's
``code_graph_service::layer_drift_result``). It is DARK by default — these
columns let an operator turn it on per tenant / per (tenant, repo). Two
nullable BOOLEAN columns, each NULL = "inherit the next tier up":

1. ``coord.tenant_merge_settings.layering_gate_enabled``
   — tenant-tier default. NULL = inherit the env / global default (OFF).

2. ``coord.tenant_repo_profiles.layering_gate_enabled_override``
   — per-(tenant, repo) override. NULL = inherit the tenant tier.

Resolution order (highest precedence first), as resolved by coord's
PR-merge gate (``qontinui-coord/src/pr_merge/settings.rs``):

    1. tenant_repo_profiles.layering_gate_enabled_override
    2. tenant_merge_settings.layering_gate_enabled
    3. env  QONTINUI_LAYERING_GATE_ENABLED
    4. Defaults::LAYERING_GATE_ENABLED = false

Decoupled deploy order: coord reads these two columns via a SEPARATE,
best-effort query (NOT folded into the main resolver SELECT). The coord
build that consumes them falls through to env / default cleanly when the
columns are absent — so there is no coord<->web deploy-ordering constraint
for this migration.

Idempotency: column adds are guarded by an inspector check (skip
``add_column`` if the column already exists). Re-running against an
already-migrated DB is a no-op. ``downgrade()`` drops the columns
(reverse order). No CHECK constraints — a nullable BOOLEAN is already
fully constrained.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "layering_gate_cols_01"
down_revision: str = "coord_maintenance_2026_06_08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two layering-gate opt-in columns (nullable BOOLEAN)."""

    # 1. tenant-tier default.
    if not _has_column("tenant_merge_settings", "layering_gate_enabled"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("layering_gate_enabled", sa.Boolean(), nullable=True),
            schema="coord",
        )

    # 2. per-(tenant, repo) override.
    if not _has_column("tenant_repo_profiles", "layering_gate_enabled_override"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column(
                "layering_gate_enabled_override",
                sa.Boolean(),
                nullable=True,
            ),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the two columns (reverse order)."""

    if _has_column("tenant_repo_profiles", "layering_gate_enabled_override"):
        op.drop_column(
            "tenant_repo_profiles",
            "layering_gate_enabled_override",
            schema="coord",
        )

    if _has_column("tenant_merge_settings", "layering_gate_enabled"):
        op.drop_column(
            "tenant_merge_settings",
            "layering_gate_enabled",
            schema="coord",
        )
