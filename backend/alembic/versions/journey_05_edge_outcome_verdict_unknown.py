"""project.journey_edge_observations — the outcome CHECK accepts verdict_unknown

Revision ID: journey_05_edge_outcome_verdict_unknown
Revises: coord_topics_01
Create Date: 2026-11-20

Phase 2 (qontinui-web) of plan
``2026-11-18-the-journey-ledger-never-records-an-unknown-action-verdict-as-a-success-or-a-failure``
(its D1).

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so
any revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; never author an ``alembic merge``
revision for it.

The gap
=======

``journey_01`` closed ``outcome`` to five words: ``changed``, ``no_change``,
``error``, ``settle_timeout``, ``to_node_unobserved``. None of them says "the
action was attempted and its own verdict is unknown" — an SDK reply with no
``actionSuccess``, or a recovery attempt whose response carried no verdict. The
runner therefore collapsed such an action into ``error`` or ``changed`` /
``no_change``, recording an unknown as a failure or as a success. The plan adds
one ``EdgeOutcome`` value, wire ``verdict_unknown`` (qontinui-schemas,
Phase 1); the runner records it (Phase 3). This revision lets the ledger store
it, and must land before the runner writes it.

What changes
============

``ck_journey_edge_observations_outcome`` is re-added, under the SAME name, with
``'verdict_unknown'`` as a sixth word. Nothing else on the table changes.

``ck_journey_edge_observations_to_node_iff_observed`` is deliberately left as it
is: ``to_node IS NULL`` iff ``outcome = 'to_node_unobserved'``. So a
``verdict_unknown`` edge CARRIES a ``to_node`` — the observed destination is
still stored; only the action's own verdict is unknown (D1, first bullet).

Locks
=====

``ADD CONSTRAINT ... CHECK`` scans the table under ``ACCESS EXCLUSIVE``. The
widened CHECK passes on every existing row (each value ``journey_01`` admitted
is still admitted). The wait for the lock is bounded the way ``journey_03`` /
``journey_04`` bound theirs (``SET LOCAL lock_timeout = '3s'``), so a busy
writer fails the migration loudly instead of queueing the runner's edge writes
behind it.

Downgrade
=========

Restores ``journey_01``'s five-word CHECK. It REFUSES while any row carries
``verdict_unknown``: rewriting such a row to another word would record an
unknown as a success or a failure — exactly what this revision exists to stop —
and deleting it would drop an observed edge. An operator who really means to
roll back deals with those rows first, deliberately.

The refusing statement runs FIRST: the five-word CHECK is added under a
temporary name (``ck_journey_edge_observations_outcome_five``) while the
widened one still stands, and fails validation there. Only once it holds is the
widened CHECK dropped and the five-word one renamed to
``ck_journey_edge_observations_outcome``. So a refused downgrade changes nothing
even outside a transaction.

Shaped for coord's migration classifier
=======================================

As ``journey_01`` .. ``journey_04``: every ``op.execute`` argument, in
``upgrade()`` and ``downgrade()`` alike, is ONE static string literal inline at
the call.

The test reads the DDL out of THIS file, so it holds no copy that could drift.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "journey_05_edge_outcome_verdict_unknown"
down_revision: str | Sequence[str] | None = "coord_topics_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Re-add the outcome CHECK with verdict_unknown as a sixth word."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE project.journey_edge_observations
            DROP CONSTRAINT IF EXISTS ck_journey_edge_observations_outcome
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_edge_observations
            ADD CONSTRAINT ck_journey_edge_observations_outcome
            CHECK (outcome IN (
                'changed', 'no_change', 'error', 'settle_timeout',
                'to_node_unobserved', 'verdict_unknown'
            ))
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Restore journey_01's five-word CHECK (refuses while verdict_unknown rows exist).

    The refusing ADD runs first, under a temporary name; the widened CHECK is
    dropped only after it holds.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE project.journey_edge_observations
            ADD CONSTRAINT ck_journey_edge_observations_outcome_five
            CHECK (outcome IN (
                'changed', 'no_change', 'error', 'settle_timeout',
                'to_node_unobserved'
            ))
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_edge_observations
            DROP CONSTRAINT IF EXISTS ck_journey_edge_observations_outcome
        """
    )
    op.execute(
        """
        ALTER TABLE project.journey_edge_observations
            RENAME CONSTRAINT ck_journey_edge_observations_outcome_five
            TO ck_journey_edge_observations_outcome
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
