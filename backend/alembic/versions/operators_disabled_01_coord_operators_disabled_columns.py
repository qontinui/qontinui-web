"""coord.operators — operator-level deactivation columns

Revision ID: operators_disabled_01
Revises: coord_onboarding_connect_states
Create Date: 2026-07-28

Plan 2026-07-24-web-deactivation-must-revoke-coord-membership (Phase 1).

Today, deactivating a user in qontinui-web does NOT revoke that human's
coord membership: ``coord.operators`` has no notion of a disabled
identity, so a deactivated user's SSO subject still resolves to a live
operator row and keeps its tenant role bindings. These two columns are
the storage side of the fix — coord's authorization path (Phase 2) reads
them and refuses to mint for a disabled operator; web's deactivation path
(Phase 3) writes them.

Two nullable columns on the EXISTING ``coord.operators`` table (created
by ``coord_sso_rbac.py``):

1. ``disabled_at``      TIMESTAMPTZ NULL — when the operator was
   deactivated. NULL means "not disabled".
2. ``disabled_reason``  TEXT NULL        — free-text audit note for why
   (e.g. ``"web user deactivated"``). NULL is always permitted, including
   while disabled.

Both are nullable with NO server default, deliberately. That is what
makes the deploy order safe in BOTH directions: a coord build that reads
``disabled_at`` against a pre-migration database sees the column absent
(and degrades to "nobody is disabled"), and a post-migration database
read by any build sees NULL for every pre-existing row — i.e. the
migration alone deactivates nobody. There is no backfill.

Idempotency: column adds are guarded by an inspector check (skip
``add_column`` if the column already exists). Re-running against an
already-migrated DB is a no-op. ``downgrade()`` drops the columns
(reverse order). No CHECK constraint pairing the two columns — a
disabled operator with no recorded reason is a legitimate state.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "operators_disabled_01"
down_revision: str = "coord_onboarding_connect_states"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two operator-deactivation columns (both nullable)."""

    # 1. when the operator was deactivated; NULL = not disabled.
    if not _has_column("operators", "disabled_at"):
        op.add_column(
            "operators",
            sa.Column(
                "disabled_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            schema="coord",
        )

    # 2. audit note for why; always optional.
    if not _has_column("operators", "disabled_reason"):
        op.add_column(
            "operators",
            sa.Column("disabled_reason", sa.Text(), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the two columns (reverse order)."""

    if _has_column("operators", "disabled_reason"):
        op.drop_column("operators", "disabled_reason", schema="coord")

    if _has_column("operators", "disabled_at"):
        op.drop_column("operators", "disabled_at", schema="coord")
