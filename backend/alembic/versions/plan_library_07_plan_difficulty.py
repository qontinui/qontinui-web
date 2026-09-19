"""agent.work_artifacts — a plan's difficulty rating

Revision ID: plan_library_07_plan_difficulty
Revises: agent_questions_alert_episode_01
Create Date: 2026-09-18

Adds a difficulty rating to every ``kind = 'plan'`` row, so the plan library
can say which model tier a plan needs before anyone spends a run on it:
``high`` → Fable 5.1, ``medium`` → Opus 5, ``low`` → a fast tier (Sonnet 5.0,
DeepSeek Flash 4.1, Gemini 3.8 Flash). The rubric lives in
``app.services.plan_difficulty``; read its module docstring for the two axes
and how they fold into one level.

Columns (all nullable):

* ``difficulty`` — the routing level. A plan's declared ``Difficulty:`` stamp
  when it carries one, else the computed level.
* ``difficulty_conceptual`` / ``difficulty_implementation`` — the two computed
  axes, kept even when a declared stamp overrides the level, so a reader can
  see where the author and the rubric disagree.
* ``difficulty_source`` — ``declared`` or ``computed``.
* ``difficulty_rubric_version`` — the rubric that produced the rating.
* ``difficulty_signals`` — the measured inputs (phases, repos, file paths,
  concept families, …), for the console's explanation.

**NULL is UNRATED, never "low".** Nothing is backfilled here, deliberately:
the rating is a pure function of the body, and an alembic revision that
imported the rubric would freeze today's rubric into the migration history
(no revision in this tree imports ``app``). Instead the rating is written by
the upsert whenever a body changes, and ``GET /plan-library/difficulty``
rates every plan row whose ``difficulty_rubric_version`` is NULL or older than
the running rubric before it answers — so the first read after deploy rates
the corpus, and every later rubric bump re-rates it the same way.

The three level columns carry CHECKs, because the API and the console key
colour and routing off the exact word; ``difficulty_source`` likewise. They
are declared inside each ``ADD COLUMN`` — see ``_COLUMNS`` for why.

Downgrade drops the six columns, and their CHECKs with them. Every one is
derived from ``body``, so nothing is lost that the next read would not
recompute.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_07_plan_difficulty"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "agent_questions_alert_episode_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent.work_artifacts"

_LEVELS = "('low', 'medium', 'high')"

#: ``(column, type, CHECK constraint name or None, CHECK predicate or None)`` in
#: upgrade order; the downgrade drops the columns reversed.
#:
#: Each CHECK is declared INSIDE its ``ADD COLUMN IF NOT EXISTS`` as a named
#: column constraint, never as a separate ``DROP CONSTRAINT IF EXISTS`` +
#: ``ADD CONSTRAINT`` pair. Two reasons, both load-bearing:
#:
#: * coord's merge-train migration classifier
#:   (``qontinui-coord`` ``crates/coord/src/pr_merge/migration_classifier.rs``)
#:   rejects any ``DROP`` inside ``ALTER TABLE`` and any ``ADD CONSTRAINT``
#:   without ``NOT VALID``, and a rejection parks the PR on
#:   ``escalate-path-matched``. The first cut of this revision was parked
#:   exactly that way (2026-09-18).
#: * It stays re-runnable: ``IF NOT EXISTS`` skips the column AND its
#:   constraint together, so a partially-applied upgrade re-runs cleanly
#:   without a drop. Validating the CHECK costs nothing — the column is new,
#:   so every existing row holds NULL, which every CHECK here admits.
#:
#: Dropping a column drops its column constraints with it, which is why the
#: downgrade names only columns.
_COLUMNS: tuple[tuple[str, str, str | None, str | None], ...] = (
    (
        "difficulty",
        "TEXT",
        "ck_work_artifacts_difficulty",
        f"difficulty IN {_LEVELS}",
    ),
    (
        "difficulty_conceptual",
        "TEXT",
        "ck_work_artifacts_difficulty_conceptual",
        f"difficulty_conceptual IN {_LEVELS}",
    ),
    (
        "difficulty_implementation",
        "TEXT",
        "ck_work_artifacts_difficulty_implementation",
        f"difficulty_implementation IN {_LEVELS}",
    ),
    (
        "difficulty_source",
        "TEXT",
        "ck_work_artifacts_difficulty_source",
        "difficulty_source IN ('declared', 'computed')",
    ),
    ("difficulty_rubric_version", "INTEGER", None, None),
    ("difficulty_signals", "JSONB", None, None),
)


def upgrade() -> None:
    """Add the nullable rating columns, each with its vocabulary CHECK.

    One PLAIN string literal per call — no f-string, no formatting — because
    coord's migration classifier (qontinui-coord#2251) rejects dynamic SQL:
    it cannot prove an interpolated column type or constraint is additive.
    ``_COLUMNS`` above is the same DDL as data, and
    ``test_plan_library_07_plan_difficulty_migration`` asserts the two agree.
    """
    op.execute(
        "ALTER TABLE agent.work_artifacts ADD COLUMN IF NOT EXISTS difficulty TEXT "
        "CONSTRAINT ck_work_artifacts_difficulty "
        "CHECK (difficulty IN ('low', 'medium', 'high'))"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS difficulty_conceptual TEXT "
        "CONSTRAINT ck_work_artifacts_difficulty_conceptual "
        "CHECK (difficulty_conceptual IN ('low', 'medium', 'high'))"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS difficulty_implementation TEXT "
        "CONSTRAINT ck_work_artifacts_difficulty_implementation "
        "CHECK (difficulty_implementation IN ('low', 'medium', 'high'))"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS difficulty_source TEXT "
        "CONSTRAINT ck_work_artifacts_difficulty_source "
        "CHECK (difficulty_source IN ('declared', 'computed'))"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS difficulty_rubric_version INTEGER"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS difficulty_signals JSONB"
    )


def downgrade() -> None:
    """Drop them (their CHECKs go with them). Every column derives from ``body``."""
    for column, _column_type, _check_name, _check in reversed(_COLUMNS):
        op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {column}")
