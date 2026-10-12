"""coord.claude_account_usage — weekly_utilization may be NULL (no reading)

Revision ID: coord_claude_acct_usage_03
Revises: coord_wt_cargo_lock_01
Create Date: 2026-10-07

Plan ``2026-10-07-mobile-account-usage-stale-tenant-feed-remediation`` item #6,
step (a).

Drops ``NOT NULL`` and ``DEFAULT 0`` from
``coord.claude_account_usage.weekly_utilization`` (created by
``coord_claude_acct_usage_01_account_usage``).

## Why

A runner whose usage probe FAILED (``error: true``, no ``weekly_resets_at``)
has no weekly reading for that account, but the column could not say so: it
was ``DOUBLE PRECISION NOT NULL DEFAULT 0``, and coord's wire type was a bare
``f64``. So the runner mirror posted a placeholder (``0.0`` or ``1.0``) and
every consumer read the placeholder as a measurement: the mobile Account Usage
card counted those rows as readings and inflated its "N machines" figure. A
NULL is the honest value: **NULL means "no reading", not 0% and not 100%.**

## Three-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``). The plan orders #6 as:

1. this revision (column accepts NULL);
2. qontinui-coord: ``WireAccount.weekly_utilization: Option<f64>`` with
   ``#[serde(default)]``, read back as ``Option<f64>`` and serialized as
   ``null``, never ``0.0``;
3. qontinui-runner: send ``None`` when ``error.is_some() && resets_at.is_none()``.

Applying this revision ahead of steps 2 and 3 is safe. The coord build in
production always binds a concrete ``f64`` on insert, so it never writes NULL,
and its read (``row.try_get(2).unwrap_or(0.0)``) maps a NULL to ``0.0``, which
is its behavior today. Nothing reads NULL until step 2 ships.

## Existing rows are left alone (deliberate)

The plan does not ask for a backfill, and the rows that carry placeholders
(``error`` and ``weekly_resets_at IS NULL``) are whole-roster upserts that each
device rewrites every ~10 minutes. They become NULL on their own once the
step-3 runner reports. A one-time rewrite here would only last until the
device's next report while it still runs a pre-step-3 build.

## Downgrade is lossy by necessity

Restoring ``NOT NULL`` requires a value for every NULL row, so ``downgrade()``
writes ``0`` into them first. That turns "no reading" back into "0%", which is
exactly the pre-revision behavior that coord's ``unwrap_or(0.0)`` already
produced. Nothing that the pre-revision schema could represent is lost.

## Safety

Dropping a NOT NULL constraint and a column default are both catalog-only
changes (no table rewrite, brief ACCESS EXCLUSIVE lock). The table holds one row
per (tenant, device, account) and is tiny regardless. ``ALTER TABLE IF EXISTS``
and a ``to_regclass`` guard on the downgrade backfill keep both directions
offline-safe (``alembic ... --sql``) with no ``op.get_bind()`` inspection.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_claude_acct_usage_03"
down_revision: str | Sequence[str] | None = "coord_wt_cargo_lock_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Let weekly_utilization hold NULL (= no reading), with no default."""
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.claude_account_usage
            ALTER COLUMN weekly_utilization DROP NOT NULL,
            ALTER COLUMN weekly_utilization DROP DEFAULT
        """
    )


def downgrade() -> None:
    """Restore NOT NULL DEFAULT 0, writing 0 into any NULL row first."""
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.claude_account_usage') IS NOT NULL THEN
                UPDATE coord.claude_account_usage
                    SET weekly_utilization = 0
                    WHERE weekly_utilization IS NULL;
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.claude_account_usage
            ALTER COLUMN weekly_utilization SET DEFAULT 0,
            ALTER COLUMN weekly_utilization SET NOT NULL
        """
    )
