"""coord.gates — continuation_deferred_device_id, the device that posted the refusal

Revision ID: cfo_01_continuation_deferred_device
Revises: overview_06_cost_category_parent
Create Date: 2026-11-15

Phase 1a of plan
``2026-11-15-gate-continuations-fail-over-off-a-device-that-refuses-them-for-load``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

## What this is for

coord's ``post_continuation_deferred`` route bumps
``continuation_deferred_count`` and stamps ``continuation_deferred_reason``
whatever ``device_id`` the body names (short of a device the continuation was
re-routed off, which it ignores); nothing records WHO posted the refusal.
Phase 1 of the plan adds a load-class trip arm that re-routes a continuation
off its target on the FIRST verified load refusal (``thread_pressure:`` /
``commit_pressure:``) instead of waiting for ten hourly stamps. That arm must
key on the target's OWN refusal, or any peer could move someone else's work,
so Phase 1's route will record the posting device here — but only when the post carried
a device JWT whose claims name the body's ``device_id``; otherwise it writes
NULL (D7).

- ``continuation_deferred_device_id UUID NULL``. Every post overwrites it.
  NULL means "no verified poster" — an unverified post, or a post that
  predates this column — never "no device". The Load arm treats NULL as not
  tripped.

## NO index

The interim "devices refusing for load" read filters live continuations by a
load-class reason prefix and a recent ``continuation_deferred_at``, a handful
of rows; this column is a projected/compared value, never the leading
predicate. Same posture as ``contstall_01`` / ``contspawn_01``.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` and an explicit
``coord.`` schema on every statement (the ``alembic-schema-arg-gate`` hook),
mirroring ``contspawn_01_gates_continuation_spawn_attempts``. The column is
nullable with no default, so the ALTER is catalog-only.

No coord code reads or writes this column yet: the plan's Phase 1 (a
separate qontinui-coord PR) adds the writer and the reader, both behind a
``SchemaReadiness`` probe that omits the column while unobserved, and this migration lands FIRST (the "web migration
first" rule). Chains off the current head ``overview_06_cost_category_parent``;
coord re-points ``down_revision`` at land time if the head moves.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cfo_01_continuation_deferred_device"
down_revision: str | Sequence[str] | None = "overview_06_cost_category_parent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Record the device that posted a continuation's latest refusal."""
    # NULL = no verified poster (unverified post, or one predating this column).
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_deferred_device_id UUID NULL
        """)


def downgrade() -> None:
    """Drop the refusing-device column."""
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_deferred_device_id"
    )
