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
``LandTime::Unverifiable``. A PR that coord ff-lands by replaying it onto new
shas reads closed on GitHub and carries no GitHub ``merged_at``, so such a
question is kept forever.

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
reference later. Gate references are not recorded here. A cited gate that
clears after the ask is seen by the sweep's next tick. Coord's
``retention_worker`` archives a terminal gate 14 days after it goes terminal
and deletes it 90 days after that, so a gate the sweep can no longer read
leaves the question kept, which is the conservative outcome.

Locking
=======

A single catalog-only ``ADD COLUMN`` with no default (ACCESS EXCLUSIVE, no
rewrite). Both directions bound the wait with ``SET LOCAL lock_timeout =
'3s'``. Neither restores the bound itself. env.py's
``on_version_apply=_reset_revision_settings`` hook issues ``RESET
lock_timeout`` after every applied step, and
``tests/test_alembic_env_setting_reset.py`` pins that. A ``RESET`` in this
file would be redundant, and on the upgrade path it would be harmful: coord's
migration classifier (``crates/coord/src/pr_merge/migration_classifier.rs``)
fails every ``RESET`` closed. This follows ``coord_agent_questions_recommendation``.

Ordering
========

This lands BEFORE coord's PR [served policy ``production-and-cost``
``alembic-sole-authorship``]. That PR must read the column only when
``schema_readiness`` reports it present, and otherwise degrade to the current
rule. Both directions are idempotent.

The downgrade loses data. Once coord records readings, ``ref_observed`` holds
first readings taken precisely because the evidence behind them ages out, so a
dropped value cannot be recomputed.
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
    # Bound the DDL's lock wait; see the docstring's Locking section. No RESET
    # follows: env.py's on_version_apply hook restores lock_timeout after this
    # step, and coord's migration classifier fails any RESET here closed.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS ref_observed JSONB
        """
    )


def downgrade() -> None:
    """Drop ``ref_observed``."""
    # Bounded as in upgrade(); env.py's hook restores lock_timeout after it too.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS ref_observed
        """
    )
