"""pr_merge — per-tenant + per-repo auto_fix_red_main opt-in columns

Revision ID: auto_fix_red_main_01
Revises: coord_repo_branches_author_binding
Create Date: 2026-07-06

Plan 2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert
(Phase 3 / D6).

Adds the "auto-spawn a fix session when this repo's main goes red" opt-in to
the three-tier PR-merge settings substrate (the exact parallel of
``layering_gate_cols_01`` / ``blast_radius_gate_cols_01``). A red main is a
tenant-wide merge outage with no owning session; when this flag is ON for a
``(tenant, repo)`` pair, coord's red-main watcher may auto-spawn ONE visible
fix session on the operator's device whose fix lands via coord's audited
recovery lane (Phase 4 consumes the flag; Phase 3 is storage + resolution +
read/write path only).

It is OFF by default — auto-force-landing to a protected branch is exactly
the kind of powerful, no-surprise-sensitive action that must be opt-in.
There is deliberately NO env-tier global enable: arming auto-spawn is a
per-tenant decision made in the web console, never an operator-wide env
flip. Two nullable BOOLEAN columns, each NULL = "inherit the next tier up":

1. ``coord.tenant_merge_settings.auto_fix_red_main``
   — tenant-tier default. NULL = inherit the global default (OFF).

2. ``coord.tenant_repo_profiles.auto_fix_red_main``
   — per-(tenant, repo) override. NULL = inherit the tenant tier.

Resolution order (highest precedence first), as resolved by coord's
settings resolver (``qontinui-coord/src/pr_merge/settings.rs``):

    1. tenant_repo_profiles.auto_fix_red_main
    2. tenant_merge_settings.auto_fix_red_main
    3. Defaults::AUTO_FIX_RED_MAIN = false

Decoupled deploy order: coord reads these two columns via a SEPARATE,
best-effort query (NOT folded into the main resolver SELECT). The coord
build that consumes them falls through to the default (OFF) cleanly when
the columns are absent — so there is no coord<->web deploy-ordering
constraint for this migration.

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
revision: str = "auto_fix_red_main_01"
down_revision: str = "coord_repo_branches_author_binding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two auto_fix_red_main opt-in columns (nullable BOOLEAN)."""

    # 1. tenant-tier default.
    if not _has_column("tenant_merge_settings", "auto_fix_red_main"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("auto_fix_red_main", sa.Boolean(), nullable=True),
            schema="coord",
        )

    # 2. per-(tenant, repo) override.
    if not _has_column("tenant_repo_profiles", "auto_fix_red_main"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column("auto_fix_red_main", sa.Boolean(), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the two columns (reverse order)."""

    if _has_column("tenant_repo_profiles", "auto_fix_red_main"):
        op.drop_column(
            "tenant_repo_profiles",
            "auto_fix_red_main",
            schema="coord",
        )

    if _has_column("tenant_merge_settings", "auto_fix_red_main"):
        op.drop_column(
            "tenant_merge_settings",
            "auto_fix_red_main",
            schema="coord",
        )
