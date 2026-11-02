"""project.journey_explorations — stop_detail on any stop, when it is an object

Revision ID: journey_04_explorations_stop_detail_any_stop
Revises: recurring_agents_01
Create Date: 2026-10-29

Phase 3 (qontinui-web half, third revision) of plan
``2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time``.

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so
any revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; never author an ``alembic merge``
revision for it.

What changes
============

``journey_03`` added ``stop_detail`` — the runner's ``unsettled`` block — and
``ck_journey_explorations_stop_detail`` allowed it ONLY on a
``frontier_unsettled`` row. But the runner measures that block whatever stopped
the run, and a run stopped by a BUDGET (or an unreachable app, or an auth wall)
can carry unknowns too: action events the producer's queue dropped, journey
writes that failed while it ran, or a closing look the runner could not tie to a
node. The explore answer carried them; the stored row could not, so they were
lost from the durable record. Unknown is first-class: it must not exist only in
an HTTP answer nobody kept.

So ``ck_journey_explorations_stop_detail`` is re-added, under the SAME name,
as: ``stop_detail`` is NULL, or a JSON object — on ANY stop. Nothing else on the
table changes.

What stays as it was, decided against ``journey_03``'s text:

- **A frontier_unsettled row is still not REQUIRED to carry it.** ``journey_03``
  never required it at the database (its CHECK allowed NULL on every row; the
  runner's own pre-insert check is what refuses an unsettled row without its
  breakdown). Adding that requirement here would fail this upgrade on any
  existing unsettled row a non-runner writer stored with NULL, and it is the
  writer's contract, not the table's.
- **It is still meaningful on a frontier_unsettled row**: there it says WHY the
  frontier was not exhausted. On any other stop the stop word is the reason, and
  ``stop_detail`` is what the run measured on the way — unknowns it carried, not
  why it stopped. The runner writes it on such a row only when the block records
  something (``Unsettled::any``), so NULL there still means "nothing to report".

Locks
=====

``ADD CONSTRAINT ... CHECK`` scans the table under ``ACCESS EXCLUSIVE``. The
relaxed CHECK passes on every existing row (each value ``journey_03`` admitted
is already an object). The table holds one row per explorer run, so the scan is
short; the wait for the lock is bounded the way ``journey_03`` bounds its own
(``SET LOCAL lock_timeout = '3s'``), so a busy writer fails the migration loudly
instead of queueing every reader behind it.

Downgrade
=========

Restores ``journey_03``'s CHECK. It REFUSES while any row that is NOT
``frontier_unsettled`` carries a ``stop_detail``: dropping a recorded unknown is
exactly what this revision exists to stop. An operator who really means to roll
back clears those values first, deliberately.

The refusing statement runs FIRST: the tighter CHECK is added under a temporary
name (``ck_journey_explorations_stop_detail_unsettled_only``) while the relaxed
one still stands, and fails validation there. Only once it holds is the relaxed
CHECK dropped and the tighter one renamed to
``ck_journey_explorations_stop_detail``. So a refused downgrade changes nothing
even outside a transaction.

How the runner tells the two shapes apart
=========================================

The paired qontinui-runner change (the follow-up stacked on qontinui-runner#2438,
landing alongside this revision) makes the write path probe for a CHECK on this
table whose definition names both ``stop_detail`` and ``frontier_unsettled``
(``journey_03``'s, or this revision's downgrade). While one stands it withholds
``stop_detail`` from a row that is not ``frontier_unsettled`` — the insert never
fails on it — and says so in the answer's ``persistence``. After this revision no
such CHECK exists, so it writes the block on every stop that carries one. A runner
build without that change writes ``stop_detail`` only on ``frontier_unsettled``
rows, which both revisions accept.

Shaped for coord's migration classifier
=======================================

As ``journey_01`` .. ``journey_03``: every ``op.execute`` argument, in
``upgrade()`` and ``downgrade()`` alike, is ONE static string literal inline at
the call.

The test reads the DDL out of THIS file, so it holds no copy that could drift.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "journey_04_explorations_stop_detail_any_stop"
down_revision: str | Sequence[str] | None = "recurring_agents_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Re-add the stop_detail CHECK: NULL or a JSON object, on any stop."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            DROP CONSTRAINT IF EXISTS ck_journey_explorations_stop_detail
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            ADD CONSTRAINT ck_journey_explorations_stop_detail
            CHECK (stop_detail IS NULL OR jsonb_typeof(stop_detail) = 'object')
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Restore journey_03's CHECK (refuses while another stop carries a detail).

    The refusing ADD runs first, under a temporary name; the relaxed CHECK is
    dropped only after it holds.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            ADD CONSTRAINT ck_journey_explorations_stop_detail_unsettled_only
            CHECK (stop_detail IS NULL OR (
                stopped_because = 'frontier_unsettled'
                AND jsonb_typeof(stop_detail) = 'object'
            ))
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            DROP CONSTRAINT IF EXISTS ck_journey_explorations_stop_detail
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            RENAME CONSTRAINT ck_journey_explorations_stop_detail_unsettled_only
            TO ck_journey_explorations_stop_detail
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
