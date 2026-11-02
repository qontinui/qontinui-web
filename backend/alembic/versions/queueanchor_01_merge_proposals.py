"""queue-anchor 01 — coord.merge_proposals.queue_anchor_at, the queue place a repaired PR keeps

Revision ID: queueanchor_01
Revises: credprobe_01
Create Date: 2026-10-15

Phase 3 of plan ``2026-10-01-pr-repair-is-timed-by-cause-not-by-transition``
("queue position retention").

What it is for
==============

coord orders its merge queue by ``(tier, rank, proposal_id)``, and ages a
proposal by its own ``created_at``. A PR whose proposal goes terminal (a
conflict, a red candidate) and is then repaired gets a NEW proposal row, so it
re-enters at the back of the queue. Measured 2026-10-15 over 30 days of
production (the plan's Phase 0.6): repaired re-proposals entered with p50 40 /
p90 127 proposals ahead of them — the back of the queue in 455 of 455 cases —
where an anchor on the PR's first proposal would have put them p50 4 / p90 47
ahead. (Numbers, and the query text that produced them: the plan's section
"0.6 — results", measured read-only in production through Door A.) The
siblings that land during that second wait are what turns the PR red again.

``queue_anchor_at`` is the time the PR FIRST became ready. The coord change of
the same phase is meant to stamp it when it inserts a proposal, inheriting it
from the PR's predecessor proposal, and to read
``COALESCE(queue_anchor_at, created_at)`` in its ordering and aging. Those
stamping rules belong to coord and are deliberately NOT written into the column
comment, which states only the contract this revision owns.

Why a column and not a derivation
=================================

The plan's Decision 7 tried to derive the anchor from ``merge_proposals``
history. Phase 0.6 falsified that: when a PR is re-enqueued at a new head,
coord's ``void_stale_head_proposal`` DELETES the live predecessor row (and its
``merge_proposal_repos`` rows cascade with it). That happened 275 times in the
30-day window, against 489 repaired re-proposals whose predecessor survived
(the population the position figures above are measured over; 455 of those 489
had any queue ahead of them at all) — so about 36% of repairs leave no row to
derive from. The anchor has to be
carried forward at insert time, which needs a column.

Shape
=====

Nullable, no default, no backfill. A NULL means "no anchor was recorded" and
every reader must coalesce it to ``created_at``, which is exactly today's ordering
for every existing row. So this revision changes no behaviour on its own, and it
can land and sit harmlessly before the coord change that writes and reads the
column — the order served policy ``production-and-cost``
``alembic-sole-authorship`` requires.

Chains off ``credprobe_01``
===========================

That was the single local alembic head on ``origin/main`` at ``7587dc7b8``
(every ``down_revision`` edge parsed; exactly one revision named by none). The
head moves on a busy repo: if another revision lands first, re-point
``down_revision``, the ``Revises:`` header above and ``_PARENT_REVISION_ID`` in
the companion test together. No ``alembic merge``.

Safety and idempotency
======================

``ADD COLUMN IF NOT EXISTS`` of a nullable, default-less column is a
catalogue-only ``ALTER`` that rewrites no row, but it still takes a brief
``ACCESS EXCLUSIVE`` lock on a table coord's scheduler touches every tick, so
the wait is bounded with ``lock_timeout``. ``IF NOT EXISTS`` is type-blind, so
the companion test asserts the type by name. ``COMMENT ON`` is re-runnable.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "queueanchor_01"
down_revision: str | Sequence[str] | None = "credprobe_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable queue_anchor_at column to coord.merge_proposals."""
    # Bound the lock wait: coord's merge scheduler reads and writes this table
    # every tick, so a blocked apply should fail fast rather than queue in
    # front of it.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS queue_anchor_at TIMESTAMPTZ"
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.merge_proposals.queue_anchor_at IS
            'When this PR first became ready: the queue place a repaired PR '
            'is meant to keep across a new proposal row (intended writer: '
            'coord, Phase 3 of plan '
            '2026-10-01-pr-repair-is-timed-by-cause-not-by-transition). '
            'Contract for every reader: NULL means no anchor was recorded; '
            'order and age by COALESCE(queue_anchor_at, created_at), which '
            'for NULL is exactly created_at.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Remove queue_anchor_at. Exact reverse of upgrade(); its comment goes with it."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS queue_anchor_at"
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
