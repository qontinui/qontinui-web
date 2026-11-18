"""coord.claude_account_usage — when a device's full roster stopped carrying a label

Revision ID: coord_claude_acct_usage_05
Revises: cirscope_02_devices_ci_runner_scope_index
Create Date: 2026-11-17

Phase 1 of plan
``2026-11-17-coord-retires-claude-account-usage-rows-a-device-stopped-reporting``.

Adds ``retired_at TIMESTAMPTZ NULL`` to ``coord.claude_account_usage`` (the
table created by ``coord_claude_acct_usage_01_account_usage``).

## Why

Rows are keyed ``(tenant_id, device_id, account_label)`` and upserted on every
runner usage report, and nothing ever removed one. A label a device STOPS
reporting (a config dir renamed from ``~/.claude`` to ``~/.claude-gmail``) was
served forever as its own account. coord now treats a report the runner marks
``roster_complete: true`` as authoritative for that device: a label absent from
it is stamped ``retired_at``, every read excludes retired rows, and a row
retired for more than 7 days is deleted by that device's next full report.

## Nullable, no default, no backfill (deliberate)

NULL means LIVE, which every existing row is until a full-roster report says
otherwise. There is nothing to backfill from: only the reporting device knows
its roster.

## No index

The only statements that filter on ``retired_at`` are scoped to one
``(tenant_id, device_id)``, which the existing unique constraint
``uq_claude_account_usage_identity`` already indexes as its leading pair, and a
device carries a few dozen rows at most. The reads add ``retired_at IS NULL``
to a tenant- or user-scoped scan that is already bounded by the same keys.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema. The coord
change that writes and reads this column is downstream of this one, so this
migration must be applied in production BEFORE that coord binary ships. That
coord change is also written to tolerate the column's absence (PG ``42703``
falls back to the pre-column reads and skips the roster step).

## Head choice

``down_revision`` is the repo's single alembic head on ``origin/main`` at
authoring time (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=cirscope_02_devices_ci_runner_scope_index``, 2026-11-17). A sibling
revision landing first means re-pointing this one onto the new head.

## Safety

The nullable ``ADD COLUMN`` with no default is metadata-only on PG >= 11.
The statement is a static literal guarded by ``IF NOT EXISTS`` / ``IF EXISTS``,
so it re-runs cleanly and the file stays offline-safe (no ``op.get_bind()``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_claude_acct_usage_05"
# KEEP THIS ASSIGNMENT ON ONE LINE: coord's alembic-graph parser is line-scoped.
down_revision: str = "cirscope_02_devices_ci_runner_scope_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable retirement stamp."""
    # Plain literals, never f-strings: the `alembic-schema-arg-gate` pre-commit
    # hook and coord's migration_classifier both read the raw SQL statically.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.claude_account_usage
            ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ
        """
    )


def downgrade() -> None:
    """Drop the column. Roll back the coord build that reads it first."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.claude_account_usage DROP COLUMN IF EXISTS retired_at"
    )
