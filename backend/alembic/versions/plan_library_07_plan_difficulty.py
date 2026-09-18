"""agent.work_artifacts — a plan's difficulty rating

Revision ID: plan_library_07_plan_difficulty
Revises: coord_overlap_detections
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
colour and routing off the exact word; ``difficulty_source`` likewise.

Downgrade drops the six columns. Every one is derived from ``body``, so
nothing is lost that the next read would not recompute.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_07_plan_difficulty"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "coord_overlap_detections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent.work_artifacts"

_LEVELS = "('low', 'medium', 'high')"

#: ``(column, type)`` in upgrade order; the downgrade drops them reversed.
_COLUMNS: tuple[tuple[str, str], ...] = (
    ("difficulty", "TEXT"),
    ("difficulty_conceptual", "TEXT"),
    ("difficulty_implementation", "TEXT"),
    ("difficulty_source", "TEXT"),
    ("difficulty_rubric_version", "INTEGER"),
    ("difficulty_signals", "JSONB"),
)

#: ``(constraint name, predicate)``. NULL passes every one — unrated is legal.
_CHECKS: tuple[tuple[str, str], ...] = (
    ("ck_work_artifacts_difficulty", f"difficulty IN {_LEVELS}"),
    (
        "ck_work_artifacts_difficulty_conceptual",
        f"difficulty_conceptual IN {_LEVELS}",
    ),
    (
        "ck_work_artifacts_difficulty_implementation",
        f"difficulty_implementation IN {_LEVELS}",
    ),
    (
        "ck_work_artifacts_difficulty_source",
        "difficulty_source IN ('declared', 'computed')",
    ),
)


def upgrade() -> None:
    """Add the nullable rating columns and their vocabulary CHECKs."""
    for column, column_type in _COLUMNS:
        op.execute(
            f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS {column} {column_type}"
        )
    for name, predicate in _CHECKS:
        op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {name}")
        op.execute(f"ALTER TABLE {_TABLE} ADD CONSTRAINT {name} CHECK ({predicate})")


def downgrade() -> None:
    """Drop them. Every column is derived from ``body``."""
    for name, _predicate in reversed(_CHECKS):
        op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {name}")
    for column, _column_type in reversed(_COLUMNS):
        op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {column}")
