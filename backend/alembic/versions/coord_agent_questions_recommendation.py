"""coord.agent_questions — the recommendation and what overturning it changes

Revision ID: coord_agent_questions_recommendation
Revises: devcred_01_credential_deny_and_bound_pair_codes
Create Date: 2026-09-30

Phase 3 (qontinui-web half) of plan
``2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen``.

Adds two nullable trailing TEXT columns to ``coord.agent_questions`` —
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
  than the recommendation. Meaningful only beside a recommendation, but not
  constrained to one at the schema level: the pairing is the writer's contract
  (``create_agent_question``), and a CHECK here would make the column order of
  a future writer load-bearing for no reader's benefit.

No default, no backfill. A historic row honestly carries no recommendation —
none was ever recorded — and a backfilled value would be a guess presented as
a record. ``shape_share`` therefore starts near zero and moves only as agents
begin sending the fields, which is the honest reading.

Why TWO NULLABLE TRAILING COLUMNS
=================================

The same argument the sibling ``coord_agent_questions_withdrawn`` makes, and
for the same reason: coord decodes ``COLS`` **positionally** in
``row_to_struct`` and its pre-migration narrowing (``degrade_sql``) relies on
older projections being strict prefixes of the current one. Appending nullable
columns preserves every existing ordinal; inserting would not. And nothing is
ridden on the overloaded ``context`` TEXT field, which already hides one marker
envelope.

Locking
=======

``ADD COLUMN`` with no default is catalog-only on PG 11+ (ACCESS EXCLUSIVE, no
table rewrite), but a QUEUED ACCESS EXCLUSIVE request blocks every reader and
writer arriving behind it on a table ~16 autonomous producers write
continuously. Both directions bound the wait with ``SET LOCAL lock_timeout =
'3s'`` and end with ``RESET lock_timeout`` — required, not decorative, because
``env.py`` runs every revision of one ``upgrade`` in a single transaction and
an unreset ``SET LOCAL`` would leak into every revision after this one. Same
convention as ``coord_agent_questions_withdrawn`` and
``coord_agent_questions_audience``. No index: nothing filters or orders on
either column; the needs-me read selects them beside rows already chosen by
``idx_agent_questions_pending_live``.

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
a no-op — raw ``op.execute`` rather than ``op.add_column`` for exactly that
reason.

``down_revision`` is this repo's single alembic head at authoring
(``coordinput_01_operator_inputs``), computed from the versions graph (a
revision is a head iff no revision names it as a parent). If another revision
lands ahead of this one, ``alembic-graph-pr.yml`` reports the fork and the fix
is to re-point this line at the new head — not an ``alembic merge``.

Downgrade drops both columns. Nothing is lost that was not introduced here:
every value in them is written by the coord change this revision unblocks.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_recommendation"
down_revision: str | Sequence[str] | None = "devcred_01_credential_deny_and_bound_pair_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``recommendation`` and ``if_overturned`` columns."""
    # Bound the DDL's lock wait; see the docstring's Locking section.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS recommendation TEXT,
            ADD COLUMN IF NOT EXISTS if_overturned  TEXT
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the two columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS if_overturned,
            DROP COLUMN IF EXISTS recommendation
        """
    )
    op.execute("RESET lock_timeout")
