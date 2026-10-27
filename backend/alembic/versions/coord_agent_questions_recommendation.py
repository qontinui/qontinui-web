"""coord.agent_questions — the recommendation and what overturning it changes

Revision ID: coord_agent_questions_recommendation
Revises: presentation_scope_01
Create Date: 2026-09-30

Phase 3 (qontinui-web half) of plan
``2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen``.

Adds two nullable TEXT columns to ``coord.agent_questions`` —
``recommendation`` and ``if_overturned`` — so a question an agent escalates to
the operator can arrive as *fork + recommendation* rather than as a bare
question.

Why this migration exists
=========================

``audience_profile/human-operator`` names **Escalation shape** as one of the
operator's metrics: whether what reaches him is a decision already worked
through to a recommendation (with what changes if he overturns it), or an open
question that hands the unfinished work back to him. It is not computable
today. Measured against ``crates/coord/src/agent_questions.rs`` on
qontinui-coord ``origin/main`` ``d88329b47``: ``recommend`` appears nowhere in
the file. ``AskQuestionRequest`` carries no recommendation field, so the
recommendation an agent has — when it has one — is either folded into free
text (``question`` / ``context``) or dropped, and
no reader can tell the two shapes apart.

The plan's coord read door (``coord_project_state``, its ``needs_me`` block)
serves each admitted operator question with ``recommendation``,
``if_overturned`` and a derived ``shape`` of ``fork_with_recommendation`` or
``open_question``, and a ``shape_share`` over every admitted row. That needs a
typed place to read both from, which is this revision.

What each column means
======================

* ``recommendation TEXT`` — the answer the asking agent recommends, in its own
  words. **NULL means the agent offered none**; coord serves such a row to the
  operator labelled *open question — unfinished work*. It is deliberately NOT
  required: refusing a question without one would create a new way for an
  agent to stop short, which ``decision_record/autonomy-is-the-product``
  forbids trading capability for (the plan's open fork 5).
* ``if_overturned TEXT`` — what changes if the operator picks something other
  than the recommendation. Meaningful beside a recommendation, but NOTHING
  pairs the two, and this schema deliberately does not either. coord's writer
  (``create_agent_question`` → ``record_fork_shape``, read at qontinui-coord
  ``c65863485``, #3053's head) stores whichever of the two the asker sent and
  a blank one as NULL, so a row can carry ``if_overturned`` beside a NULL
  ``recommendation``; coord derives a row's ``shape`` from ``recommendation``
  alone (``question_shape``), so that row is still served as an open
  question. A pairing CHECK would rule that row out only by failing its write,
  and coord writes both fields in ONE ``UPDATE`` after the question's
  ``INSERT``, so the CHECK would drop BOTH fields (the question itself stays
  recorded) instead of keeping the one that was sent.

No default, no backfill. A historic row honestly carries no recommendation —
none was ever recorded — and a backfilled value would be a guess presented as
a record. ``shape_share`` therefore starts near zero and moves only as agents
begin sending the fields, which is the honest reading.

Why two nullable columns, read BY NAME
======================================

coord reads both columns **by name**, never through its positional ``COLS``
projection, so their ordinal is no part of the contract and nothing in the
``row_to_struct`` / ``degrade_sql`` prefix chain moves. The coord change this
revision unblocks (read at qontinui-coord ``c65863485``, #3053's head) keeps
them out of ``COLS`` on purpose: several statements that splice ``{COLS}`` do
not degrade on a database this revision has not reached yet, so projecting a
column it adds there would turn the column's absence into a 42703 on an
authorization-bearing door. Instead both readers name the columns —
``record_fork_shape``'s ``UPDATE … RETURNING recommendation, if_overturned``
and the project-state needs-me read's ``SELECT question_id, recommendation,
if_overturned … WHERE question_id = ANY(…)`` — and decode each with
``try_get("<column name>")``. The column NAMES and TYPES are the interface,
which is why the migration test reads both back from the catalogue.

Two columns of their own rather than a marker riding on the overloaded
``context`` TEXT field, which already hides one envelope.

Locking
=======

``ADD COLUMN`` with no default is catalog-only on PG 11+ (ACCESS EXCLUSIVE, no
table rewrite), but a QUEUED ACCESS EXCLUSIVE request blocks every reader and
writer arriving behind it, and this table is written continuously. Measured on
qontinui-coord ``origin/main`` ``d2ac748e0`` (2026-10-27): 20 non-test
functions INSERT its rows — 16 policy resolvers in ``policies/decide.rs``
through ``create_escalation_question``, the edit-effect escalation, the
alert-episode filer, and the ask door over both HTTP and MCP — and 11 more
UPDATE them (answers, withdrawals, alert closes, predicate retirement). Both
directions bound the wait with ``SET LOCAL lock_timeout = '3s'``.

Neither direction restores the bound itself. ``env.py`` runs every revision of
one ``upgrade`` in a single transaction, so an unrestored ``SET LOCAL`` would
reach every later revision of the batch — but env.py's
``on_version_apply=_reset_revision_settings`` hook issues ``RESET
lock_timeout`` (and ``RESET search_path``) after every applied step, up or
down, online or offline, and ``tests/test_alembic_env_setting_reset.py`` pins
that. A ``RESET`` in this file would be redundant, and on the upgrade path
worse than redundant: coord's migration classifier
(``crates/coord/src/pr_merge/migration_classifier.rs``) admits ``SET LOCAL
lock_timeout`` / ``statement_timeout`` and fails every ``RESET`` closed, so the
trailing ``RESET lock_timeout`` both earlier generations carried was the
escalate-path hit that held their PRs. coord's merge gate recorded it on each
as ``migration classifier rejected: RESET LOCK_TIMEOUT``: on #1579's head
``5e67265c2`` (check run 110379966478, 2026-10-01) and on #1808's head
``5695334fa`` (check run 114708262430, 2026-10-12). GitHub's check-runs API
lists the second only with ``filter=all``; by default it returns just the
newest run, which on that head is a later ``conflicted`` one.
``coord_agent_questions_withdrawn`` and ``coord_agent_questions_audience``
still carry a ``RESET`` because they predate the hook (``2d8ce1cc3``,
2026-10-08).

No index: nothing filters or orders on either column. Both readers above reach
the rows by primary key (``question_id``) — the needs-me read for rows its
pending scan has already chosen, the fork-shape write for the row it just
inserted.

Ordering — this lands BEFORE coord's PR, by policy
==================================================

Served policy ``production-and-cost`` ``alembic-sole-authorship`` makes alembic
in qontinui-web the sole author of ``coord.*`` schema and requires the
migration to land (and deploy) **before** any coord read or write of the new
columns. The plan's "Cross-repo ordering" item 2 is that order: this revision
first; the qontinui-coord PR that teaches ``AskQuestionRequest`` /
``create_agent_question`` / ``coord_ask_question`` and the ``needs_me`` block
the two fields carries ``coord:downstream-of`` this PR; the qontinui-runner
``AskQuestionPayload`` mirror follows coord.

Both directions are idempotent (``IF NOT EXISTS`` / ``IF EXISTS``) so a
canonical database that self-healed ahead of alembic converges and a re-run is
a no-op. That alone does not need raw SQL: alembic as locked here (1.18.4)
renders ``op.add_column(..., if_not_exists=True)`` and
``op.drop_column(..., if_exists=True)`` with the same guards. Raw
``op.execute`` writes both columns into ONE ``ALTER TABLE`` per direction, as a
single static literal; ``op.add_column`` / ``op.drop_column`` emit a statement
per column.

``down_revision`` is this repo's single alembic head at authoring
(``presentation_scope_01``, re-pointed 2026-10-27 when the third-generation
adopting successor merged current main; it had named ``tdunbind_01`` since
2026-10-23, and the second generation, qontinui-web#1808, had pointed it at
``coord_sessions_fleet_idx_01`` and then ``ci_read_token_01``), computed from
the versions graph (a revision is a head iff no revision names it as a
parent). If another revision lands ahead of this one, ``alembic-graph-pr.yml``
reports the fork and the fix is to re-point this line — together with the
``Revises:`` line above and the migration test's ``_PARENT_REVISION_ID`` pin —
at the new head, not an ``alembic merge``.

Downgrade drops both columns. Nothing is lost that was not introduced here:
every value in them is written by the coord change this revision unblocks.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_recommendation"
down_revision: str | Sequence[str] | None = "presentation_scope_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``recommendation`` and ``if_overturned`` columns."""
    # Bound the DDL's lock wait; see the docstring's Locking section. No RESET
    # follows: env.py's on_version_apply hook restores lock_timeout after this
    # step, and coord's migration classifier fails any RESET here closed.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS recommendation TEXT,
            ADD COLUMN IF NOT EXISTS if_overturned  TEXT
        """
    )


def downgrade() -> None:
    """Drop the two columns."""
    # Bounded as in upgrade(); env.py's hook restores lock_timeout after it too.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS if_overturned,
            DROP COLUMN IF EXISTS recommendation
        """
    )
