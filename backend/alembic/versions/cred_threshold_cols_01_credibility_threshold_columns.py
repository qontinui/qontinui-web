"""pr_merge — per-tenant + per-repo credibility-threshold columns

Revision ID: cred_threshold_cols_01
Revises: twin_09_drop_qontinui_cloud_target
Create Date: 2026-06-04

run-tests gate follow-up F3.

Adds the credibility-weighted-pass-min knob to the existing three-tier
PR-merge settings substrate (see
``pr_merge_02_tenant_settings.py``). Two nullable DOUBLE PRECISION
columns, each NULL = "inherit the next tier up":

1. ``coord.tenant_merge_settings.credibility_weighted_pass_min``
   — tenant-tier default. NULL = inherit the global default (0.7).

2. ``coord.tenant_repo_profiles.credibility_weighted_pass_min_override``
   — per-(tenant, repo) override. NULL = inherit the tenant tier.

Both are constrained to the closed interval [0, 1] (NULL-permitting):
  - ``ck_tms_credibility_weighted_pass_min_range``
  - ``ck_trp_credibility_weighted_pass_min_override_range``

Resolution order (highest precedence first), as resolved by coord's
PR-merge gate (``qontinui-coord/src/pr_merge/settings.rs``):

    1. tenant_repo_profiles.credibility_weighted_pass_min_override
    2. tenant_merge_settings.credibility_weighted_pass_min
    3. env  QONTINUI_CREDIBILITY_WEIGHTED_PASS_MIN
    4. Defaults::CREDIBILITY_WEIGHTED_PASS_MIN = 0.7

Decoupled deploy order: coord reads these two columns via a SEPARATE,
best-effort query (NOT folded into the main resolver SELECT). A coord
build deployed BEFORE this migration lands simply gets nothing back
from that probe and falls through to env / default (0.7) cleanly — so
there is no coord→web deploy-ordering constraint for this migration.
The coord-side resolver PR that consumes these columns is downstream.

Idempotency: column adds are guarded by an inspector check (skip
``add_column`` if the column already exists). Re-running against an
already-migrated DB is a no-op. ``downgrade()`` drops the CHECK
constraints first, then the columns.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cred_threshold_cols_01"
down_revision: str = "twin_09_drop_qontinui_cloud_target"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two credibility-threshold columns + range CHECKs."""

    # 1. tenant-tier default.
    if not _has_column("tenant_merge_settings", "credibility_weighted_pass_min"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("credibility_weighted_pass_min", sa.Float(), nullable=True),
            schema="coord",
        )
        op.create_check_constraint(
            "ck_tms_credibility_weighted_pass_min_range",
            "tenant_merge_settings",
            "credibility_weighted_pass_min IS NULL "
            "OR (credibility_weighted_pass_min >= 0 "
            "AND credibility_weighted_pass_min <= 1)",
            schema="coord",
        )

    # 2. per-(tenant, repo) override.
    if not _has_column(
        "tenant_repo_profiles", "credibility_weighted_pass_min_override"
    ):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column(
                "credibility_weighted_pass_min_override",
                sa.Float(),
                nullable=True,
            ),
            schema="coord",
        )
        op.create_check_constraint(
            "ck_trp_credibility_weighted_pass_min_override_range",
            "tenant_repo_profiles",
            "credibility_weighted_pass_min_override IS NULL "
            "OR (credibility_weighted_pass_min_override >= 0 "
            "AND credibility_weighted_pass_min_override <= 1)",
            schema="coord",
        )


def downgrade() -> None:
    """Drop the CHECK constraints, then the columns (reverse order)."""

    if _has_column(
        "tenant_repo_profiles", "credibility_weighted_pass_min_override"
    ):
        op.drop_constraint(
            "ck_trp_credibility_weighted_pass_min_override_range",
            "tenant_repo_profiles",
            schema="coord",
            type_="check",
        )
        op.drop_column(
            "tenant_repo_profiles",
            "credibility_weighted_pass_min_override",
            schema="coord",
        )

    if _has_column("tenant_merge_settings", "credibility_weighted_pass_min"):
        op.drop_constraint(
            "ck_tms_credibility_weighted_pass_min_range",
            "tenant_merge_settings",
            schema="coord",
            type_="check",
        )
        op.drop_column(
            "tenant_merge_settings",
            "credibility_weighted_pass_min",
            schema="coord",
        )
