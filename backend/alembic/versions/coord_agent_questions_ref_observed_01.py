"""coord.agent_questions — ref_observed: the cited PR's state as first observed after the ask

Revision ID: coord_agent_questions_ref_observed_01
Revises: overlord_04_runner_start_and_nudge_time
Create Date: 2026-11-14

Plan ``2026-11-14-an-old-question-whose-pr-coord-ff-lands-later-is-kept-forever-instead-of-retired``
(qontinui-dev-notes).

Why this column exists
======================

Coord's auto-retire sweep (``question_auto_retire.rs``) retires a pending
operator question when its cited PR lands AFTER the ask. To tell "landed after
the ask" from "already landed when asked", it dates the land from
``coord.repo_branches`` / ``coord.pr_events`` evidence. That evidence is pruned
by its own age. So for an ask older than the observation window (default 120
days), coord cannot trust a coord-dated land and answers
``LandTime::Unverifiable``. A PR that coord ff-lands reads closed on GitHub, so
it never carries GitHub's ``merged_at``, and such a question is kept forever.

The fix is to persist the fact the evidence would otherwise have to
re-derive: what the cited PR's state was when coord first looked at it after
the ask.

* ``ref_observed JSONB`` — ``{"pr": {"state": "live" | "terminal_before_ask",
  "observed_at": <RFC 3339>}}``. It is written by the ask door at ask time, and
  by the sweep on its first not-landed reading of a row that has none. Every
  write is guarded ``WHERE ref_observed IS NULL``, so the first reading is
  never overwritten.

  - A stored ``live`` reading whose ``observed_at`` is at or after the ask lets
    the sweep resolve an ``Unverifiable`` land as landed-after-the-ask. A PR
    seen unlanded at time T can only land after T.
  - A stored ``terminal_before_ask`` reading is sticky. The question is kept as
    context even after the evidence of that earlier land has been pruned.

NULL on every row that exists today. Coord falls back to its current rule for
NULL rows until the sweep records a first reading.

Why JSONB rather than a timestamp
=================================

Both readings have to be storable, and the shape leaves room for a non-PR
reference later. Gate references need no reading: ``coord.gates.cleared_at``
has no time-based retention.

Locking
=======

A single catalog-only ``ADD COLUMN`` with no default (ACCESS EXCLUSIVE, no
rewrite). The wait is bounded with ``SET LOCAL lock_timeout = '3s'`` and reset
at the end, for the reasons ``coord_agent_questions_withdrawn`` sets out: one
transaction wraps the whole run, so an unreset timeout would leak into every
later revision.

Ordering
========

This lands BEFORE coord's PR [served policy ``production-and-cost``
``alembic-sole-authorship``]. Coord reads the column only when
``schema_readiness`` reports it present, and otherwise degrades to the current
rule. Both directions are idempotent.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_ref_observed_01"
down_revision: str | Sequence[str] | None = "overlord_04_runner_start_and_nudge_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``ref_observed`` column."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS ref_observed JSONB
        """
    )
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop ``ref_observed``."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS ref_observed
        """
    )
    op.execute("RESET lock_timeout")
