"""pr_merge — per-tenant + per-repo auto_fix_red_main_flaky opt-in columns

Revision ID: auto_fix_rm_flaky_01
Revises: coord_pg_overload_idx_03
Create Date: 2026-07-22

Plan 2026-07-19-coord-self-heal-scope-question-flaky-genuine-reds
(Phase 2).

Adds the opt-in for coord's WIDENED red-main self-heal — the
"flaky-genuine" class (class 2: a red main with a real job ``failure``
that passes on identical-commit re-run — a flake) — to the same three-tier PR-merge
settings substrate as its sibling ``auto_fix_red_main_01``. The existing
``auto_fix_red_main`` flag arms the original (class 1) self-heal only;
this new flag arms the widened class independently, so a tenant can run
class 1 without opting into class 2. The coord arm
(``auto_fix_red_main_flaky``) ships dark and consumes these columns only
once they exist.

It is OFF by default — auto-remediating a red main is exactly the kind of
powerful, no-surprise-sensitive action that must be opt-in. There is
deliberately NO env-tier global enable: arming is a per-tenant decision
made in the web console, never an operator-wide env flip. Two nullable
BOOLEAN columns, each NULL = "inherit the next tier up":

1. ``coord.tenant_merge_settings.auto_fix_red_main_flaky``
   — tenant-tier default. NULL = inherit the global default (OFF).

2. ``coord.tenant_repo_profiles.auto_fix_red_main_flaky``
   — per-(tenant, repo) override. NULL = inherit the tenant tier.

Resolution order (highest precedence first), as resolved by coord's
settings resolver (``qontinui-coord/src/pr_merge/settings.rs``):

    1. tenant_repo_profiles.auto_fix_red_main_flaky
    2. tenant_merge_settings.auto_fix_red_main_flaky
    3. Defaults::AUTO_FIX_RED_MAIN_FLAKY = false

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
revision: str = "auto_fix_rm_flaky_01"
down_revision: str = "coord_pg_overload_idx_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two auto_fix_red_main_flaky opt-in columns (nullable BOOLEAN)."""

    # 1. tenant-tier default.
    if not _has_column("tenant_merge_settings", "auto_fix_red_main_flaky"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("auto_fix_red_main_flaky", sa.Boolean(), nullable=True),
            schema="coord",
        )

    # 2. per-(tenant, repo) override.
    if not _has_column("tenant_repo_profiles", "auto_fix_red_main_flaky"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column("auto_fix_red_main_flaky", sa.Boolean(), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the two columns (reverse order)."""

    if _has_column("tenant_repo_profiles", "auto_fix_red_main_flaky"):
        op.drop_column(
            "tenant_repo_profiles",
            "auto_fix_red_main_flaky",
            schema="coord",
        )

    if _has_column("tenant_merge_settings", "auto_fix_red_main_flaky"):
        op.drop_column(
            "tenant_merge_settings",
            "auto_fix_red_main_flaky",
            schema="coord",
        )
