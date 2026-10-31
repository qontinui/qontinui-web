"""project.journey_explorations — frontier_unsettled, and stop_detail saying why

Revision ID: journey_03_explorations_stop_unsettled
Revises: ci_job_res_01
Create Date: 2026-10-28

Phase 3 (qontinui-web half, second revision) of plan
``2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time``.

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so
any revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; never author an ``alembic merge``
revision for it.

What changes
============

``stopped_because`` gains a SEVENTH closed word, ``frontier_unsettled``: the
run ended with activatable frontier it could not read, route or activate — a
ledger read that hit its row bound or held unparseable rows, an entry with no
observed safe route, an attempt the app failed or the path did not hold, or an
exhaustion its confirming snapshot could not tie to a fresh node. The runner's
answer names which in its ``unsettled`` block.

Before this word, such a run had to be recorded under one of the six, and every
one of them asserted something false of it (``budget_actions`` claimed a spent
action budget it had not spent; ``frontier_exhausted`` claimed what it could
not see). An unknown reason must not wear a measured reason's name, so it gets
its own. ``frontier_exhausted`` remains the ONLY stop reason under which a
later ``not_reachable`` may be claimed for the explored component;
``frontier_unsettled`` is, like the budget words, a run that stopped while
activatable frontier remained.

The row also says WHY. A new nullable ``stop_detail jsonb`` column carries the
runner's ``unsettled`` breakdown (unroutable entries, failed attempts, undrivable
entries, open ``activation_failed`` rows, an unconfirmed exhaustion, ...) for a
``frontier_unsettled`` run, and is NULL for every other stop, whose word is the
whole reason. ``ck_journey_explorations_stop_detail`` holds that: when present
it is a JSON object, and only on a ``frontier_unsettled`` row.

Nothing else on the table changes: ``ck_journey_explorations_stopped_because``
is dropped and re-added, under the same name, with the six words plus one, and
the one column (with its CHECK) is added.

Locks
=====

``ADD CONSTRAINT ... CHECK`` scans the table under ``ACCESS EXCLUSIVE``. Adding a
nullable column with no default is a catalog-only change, and its CHECK passes
trivially on existing rows (all NULL). The table holds one row per explorer run
(``journey_02``: no retention job needed), so the scans are short; the wait for the lock is bounded the way ``presentation_scope_01``
bounds its own (``SET LOCAL lock_timeout = '3s'``), so a busy writer fails the
migration loudly instead of queueing every reader behind it.

Downgrade
=========

Restores the six-word CHECK, then drops ``stop_detail``. It REFUSES while any
row reads ``frontier_unsettled``: rewriting a recorded reason into a false one
is exactly what this revision exists to stop, and deleting runs would destroy
the record. An operator who really means to roll back withdraws or deletes
those rows first, deliberately.

The refusing statement runs FIRST: the six-word CHECK is added under a
temporary name (``ck_journey_explorations_stopped_because_six``) while the
seven-word one still stands, and fails validation there. Only once it holds
is the seven-word CHECK dropped, the six-word one renamed to
``ck_journey_explorations_stopped_because``, and ``stop_detail`` dropped. So a
refused downgrade changes nothing even outside a transaction. Once no
``frontier_unsettled`` row exists every ``stop_detail`` is NULL (its CHECK
allows a value on no other row), so the drop loses no recorded detail.

Shaped for coord's migration classifier
=======================================

As ``journey_01`` / ``journey_02``: every ``op.execute`` argument, in
``upgrade()`` and ``downgrade()`` alike, is ONE static string literal inline at
the call.

The test reads the DDL out of THIS file, so it holds no copy that could drift.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "journey_03_explorations_stop_unsettled"
down_revision: str | Sequence[str] | None = "ci_job_res_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Re-add the stop-reason CHECK with the seventh word; add stop_detail."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            DROP CONSTRAINT IF EXISTS ck_journey_explorations_stopped_because
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            ADD CONSTRAINT ck_journey_explorations_stopped_because
            CHECK (stopped_because IN (
                'budget_actions', 'budget_depth', 'budget_time',
                'frontier_exhausted', 'frontier_unsettled',
                'app_unreachable', 'auth_wall'
            ))
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            ADD COLUMN stop_detail jsonb,
            ADD CONSTRAINT ck_journey_explorations_stop_detail
            CHECK (stop_detail IS NULL OR (
                stopped_because = 'frontier_unsettled'
                AND jsonb_typeof(stop_detail) = 'object'
            ))
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Restore the six-word CHECK (refuses while a frontier_unsettled row exists).

    The refusing ADD runs first, under a temporary name; the old CHECK is
    dropped and stop_detail removed only after it holds.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            ADD CONSTRAINT ck_journey_explorations_stopped_because_six
            CHECK (stopped_because IN (
                'budget_actions', 'budget_depth', 'budget_time',
                'frontier_exhausted', 'app_unreachable', 'auth_wall'
            ))
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            DROP CONSTRAINT IF EXISTS ck_journey_explorations_stopped_because
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            RENAME CONSTRAINT ck_journey_explorations_stopped_because_six
            TO ck_journey_explorations_stopped_because
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_explorations
            DROP COLUMN IF EXISTS stop_detail
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
