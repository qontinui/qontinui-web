"""coord.session_touched_files — prefix index on lower(file_path)

Revision ID: projdash_01_stf_prefix_idx
Revises: appid_01_co_occurrence_app_id
Create Date: 2026-07-28

Phase 1 of ``2026-07-24-runner-projects-dashboard``: make the Projects
dashboard's session join a range scan instead of a sequential scan.

The query
=========

Every project card answers "who worked on this, and when?" by
prefix-matching the project root against ``coord.session_touched_files``::

    SELECT stf.task_run_id, max(stf.recorded_at), count(*)
    FROM coord.session_touched_files stf
    WHERE starts_with(lower(stf.file_path), $1)   -- $1 = normalized root + sep
    GROUP BY stf.task_run_id

Two properties of that predicate drive this migration.

``lower()``, not the raw column
-------------------------------

Windows filesystems are case-insensitive and every producer writes its own
casing — the setup wizard uses the OS-reported name, the dispatcher records
whatever the agent's tool passed, the terminal records what the user typed.
The runner folds case on both sides, so the indexed expression has to be
``lower(file_path)``. The existing
``idx_session_touched_files_file_recorded (file_path, recorded_at DESC)``
is on the *raw* column and cannot serve it.

``text_pattern_ops``, not the default opclass
---------------------------------------------

The database collation is ``en_US.utf8``. Under any non-C collation the
default ``text_ops`` btree opclass orders rows by collation rules, which do
not agree with byte order, so the planner cannot rewrite a prefix test into
the ``>= 'prefix' AND < 'prefiy'`` range it needs. ``text_pattern_ops``
orders by raw byte value, which is exactly the ordering a prefix scan
requires. **Without the opclass this index is inert for this query** and
every snapshot degrades to a sequential scan.

Not a `LIKE`
============

Worth recording next to the index it supports: the read side deliberately
does not use ``LIKE 'D:\\qontinui-root\\%'``. Backslash is Postgres's
``LIKE`` escape character, so ``\\q`` and ``\\.`` are consumed as escapes
and a Windows path prefix silently mis-matches — producing an empty
dashboard rather than an error. ``starts_with`` has no escape semantics.

Concurrency
===========

Built non-concurrently: the table is small (order 10^3 rows) and alembic
runs inside a transaction, which ``CREATE INDEX CONCURRENTLY`` forbids.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "projdash_01_stf_prefix_idx"
down_revision: str = "coord_prompt_docs_05_intent_kinds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEX_NAME = "idx_session_touched_files_lower_path_prefix"


def upgrade() -> None:
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {INDEX_NAME} "
        "ON coord.session_touched_files (lower(file_path) text_pattern_ops)"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS coord.{INDEX_NAME}")
