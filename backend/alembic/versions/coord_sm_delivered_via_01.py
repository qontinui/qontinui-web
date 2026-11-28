"""coord.session_messages.delivered_via / pushed_at — push vs drain delivery

Revision ID: coord_sm_delivered_via_01
Revises: cinode_06_ci_node_directives
Create Date: 2026-11-27

manual-test-loop iteration 2, item B (qontinui-coord).

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``),
so the two columns coord reads and writes land here. Hand-authored;
``alembic revision --autogenerate`` was not run and is never run against
``coord.*``. Chained off the single head ``cinode_06_ci_node_directives``
on origin/main (re-pointed from ``overview_07_schedule_last_known`` after
``cinode_06`` landed on top of it).

Why
===

``coord.session_messages.delivered_at`` is stamped by TWO writers: the
runner's push executor (``POST /coord/session-messages/mark-delivered``,
after it injected the message into the recipient's PTY) and the recipient's
OWN ``coord_inbox`` drain. A sender reading ``delivered_at`` back cannot tell
"a runner pushed this into the live session" from "the recipient happened to
poll its inbox" — so ``delivered_at`` alone never proved push delivery, and
the send receipt said it did.

What the columns carry
======================

* ``delivered_via TEXT``: how the row was FIRST delivered — ``'push'`` (the
  runner push path) or ``'drain'`` (the recipient's own inbox drain). Written
  in the same statement that first stamps ``delivered_at``, never overwritten.
  ``NULL`` = not delivered yet, or delivered by a coord build that predates
  this column (unknown, never read as either value).
* ``pushed_at TIMESTAMPTZ``: when the runner push path stamped the row. Set
  ONLY by that path. ``NULL`` = never pushed (a drained row stays NULL).

Ordering
========

coord degrades on ``42703`` (undefined column) to today's statements, so
either deploy order is safe; until this revision applies, coord reports
``delivered_via`` / ``pushed_at`` as null.

Nullable with no default: both ADDs are catalogue-only (no table rewrite) and
need no backfill. Downgrade drops both columns.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sm_delivered_via_01"
down_revision: str | Sequence[str] | None = "cinode_06_ci_node_directives"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two nullable delivery-path columns and document them."""
    # `IF NOT EXISTS` matches on NAME only; acceptable because no revision in
    # this chain spells `delivered_via` or `pushed_at` on coord.session_messages
    # (created by `coord_session_messages`, altered by `coord_sm_to_handle`).
    # coord writes coord.session_messages on every send/drain/push; bound the
    # ACCESS EXCLUSIVE wait rather than queue every writer behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS delivered_via TEXT,
            ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.session_messages.delivered_via IS
            'How the message was first delivered: push (the runner injected it '
            'into the live recipient and called mark-delivered) or drain (the '
            'recipient drained it through coord_inbox). Written with the first '
            'delivered_at stamp, never overwritten. NULL = undelivered, or '
            'delivered by a coord that predates this column (unknown).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_messages.pushed_at IS
            'When the runner push path (mark-delivered) stamped this message. '
            'Set only by that path; NULL = never pushed.'
        """
    )


def downgrade() -> None:
    """Exact inverse — drop both columns.

    coord degrades on an undefined column, so no coord rollback is needed
    first.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.session_messages
            DROP COLUMN IF EXISTS pushed_at,
            DROP COLUMN IF EXISTS delivered_via
        """
    )
