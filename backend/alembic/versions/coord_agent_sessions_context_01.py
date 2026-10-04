"""coord.agent_sessions .context_tokens / .last_turn_at — what a session costs to wake

Revision ID: coord_agent_sessions_context_01
Revises: coord_pr_state_observed_at_01
Create Date: 2026-10-02

Phase 3 item 1 of plan
``2026-10-02-a-red-or-conflicting-pr-cannot-trigger-a-gate-continuation-and-delivery-ignores-context-cost``
(design decision D3).

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the columns coord will write land here, and this revision must be APPLIED in
production before coord reads or writes them.

Why
===

When a gate clears, coord delivers its continuation one of two ways: inject it
into the live author session, or spawn a fresh one. It picks today without
knowing what either costs. Injecting into a session whose prompt cache is warm
is cheap; injecting into a cold session re-reads its whole context at full
price, which for a large context costs more than a fresh session's bootstrap.
The two inputs that decide it -- how large the session's context is, and how
long ago its last turn ended -- exist nowhere coord can read. These columns
hold them.

They sit on ``coord.agent_sessions`` rather than ``coord.sessions`` because
liveness, which the delivery decision reads in the same breath, already lives
there (``last_seen`` / ``closed_at``), keyed by the harness session id. One row
answers both questions with no join, and ``coord.sessions.claude_code_session_id``
has been observed NULL on every live row until a late bind.

What writes it
==============

coord's session-context route (beside the hook route in
``session_tool_activity.rs``, same ``require_jwt`` auth), fed by the
qontinui-claude-config ``Stop`` hook ``scripts/session-context-report.sh``.
The hook reads the last assistant entry's ``usage`` from the transcript tail
(``input + cache_creation + cache_read``) and posts that integer with the
turn's end time -- never transcript content. The write is a plain
``UPDATE coord.agent_sessions SET ... WHERE id = $1 AND device_id = <JWT device>``:
no upsert and no rebind, so a token can only report on its own device's
sessions.

What reads it
=============

coord's continuation-delivery decision ``choose_delivery`` (plan D4), inside
the ``coord.agent_sessions`` reads that already decide liveness (the
``LEFT JOIN`` in ``resolve_author_session_unscoped`` and the direct read in
``is_session_live``). It runs in
shadow first (plan D5).

Semantics
=========

``NULL`` means the session's hook has never reported -- every existing row, and
any session on a box without the hook. The reader treats it as UNKNOWN and
keeps today's behaviour (``context_unknown``), never as a small context
(served policy ``verification-and-evidence``
``unknown-must-not-render-as-a-default``). So: no default and no backfill. A
``DEFAULT 0`` would forge a small context onto every session, and a
``DEFAULT now()`` a warm cache.

Head choice
===========

``down_revision`` is the single head of ``origin/main`` at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). Re-point rule: if
another alembic revision lands first, coord re-points ``down_revision`` at land
time; the companion test's ``_PARENT_REVISION_ID`` literal moves with it.

Safety
======

Both columns are nullable with no default, so each ADD is catalogue-only and
rewrites no row. ``coord.agent_sessions`` is written by coord on every session
heartbeat, so the ACCESS EXCLUSIVE wait is bounded with
``SET LOCAL lock_timeout = '3s'`` and restored afterwards -- env.py runs the
whole upgrade batch in one transaction, so an unrestored ``SET LOCAL`` would
impose the ceiling on every later revision (the
``agent_questions_alert_episode_01_open_question_per_alert_episode`` bracket).
Every SQL string is a static literal, so the revision renders unchanged in
offline ``--sql`` mode. Downgrade drops both columns ``IF EXISTS``; the data
does not return.

No index: the reader looks a row up by its primary key, which it already does
for liveness.

Merge-train classifier disposition
==================================

The lock bracket makes ``upgrade()`` unclassifiable to coord's migration
classifier (``SET ...`` matches no branch of ``classify_sql_statement``), so an
``auto_if_provably_safe`` escalate policy covering this glob returns Blocked
rather than clearing. That is the known price of the guard, the same one
``coord_pr_state_observed_at_01`` documents, not a defect.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_sessions_context_01"
down_revision: str | Sequence[str] | None = "coord_pr_state_observed_at_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable context-size and last-turn columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # IF NOT EXISTS matches on NAME only; acceptable because no revision in
    # this chain spells either column on this table.
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            ADD COLUMN IF NOT EXISTS context_tokens INTEGER,
            ADD COLUMN IF NOT EXISTS last_turn_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.context_tokens IS
            'Context size in tokens at the end of the last turn (input + '
            'cache_creation + cache_read of the last assistant usage). Written '
            'by the coord session-context route, fed by the qontinui-claude-config '
            'Stop hook session-context-report.sh. Read by the coord '
            'continuation-delivery decision choose_delivery (plan '
            '2026-10-02-a-red-or-conflicting-pr-cannot-trigger-a-gate-continuation-and-delivery-ignores-context-cost). '
            'NULL = the hook never reported; read as UNKNOWN, never as small.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.last_turn_at IS
            'When the last turn ended, as reported with context_tokens. Written '
            'by the coord session-context route, fed by the qontinui-claude-config '
            'Stop hook session-context-report.sh. Read by the coord '
            'continuation-delivery decision choose_delivery to judge whether the '
            'prompt cache is still warm (plan '
            '2026-10-02-a-red-or-conflicting-pr-cannot-trigger-a-gate-continuation-and-delivery-ignores-context-cost). '
            'NULL = the hook never reported; read as UNKNOWN, never as warm.'
        """
    )

    # env.py runs the whole batch in one transaction, so leaving this set would
    # silently impose a 3 s ceiling on the next revision's DDL too.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop both columns (a catalogue inverse; the data does not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            DROP COLUMN IF EXISTS last_turn_at,
            DROP COLUMN IF EXISTS context_tokens
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")
