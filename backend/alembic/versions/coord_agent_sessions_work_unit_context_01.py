"""coord.agent_sessions .work_unit_context_* -- a session's OWN plan, for parked messages

Revision ID: coord_agent_sessions_work_unit_context_01
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

Phase 1 of plan
``2026-11-04-a-parked-message-is-bound-to-a-peers-work-unit-when-that-peer-holds-the-devices-only-dated-intent``.

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the columns coord will write land here, and this revision must be APPLIED in
production before coord's stamp can take effect.

Why
===

A ``claim:`` / ``resource:`` session-bus message with no live holder is parked
bound to the SENDER's work-unit context, and collected only by a holder whose
context matches. coord derived both contexts from a scan of the DEVICE's
``coord.agent_status`` rows, because ``coord_declare_intent`` and
``coord_report_status`` write only that device-keyed table and it carries no
session. With one dated intent on a device the scan returned it whoever
declared it, so a session that declared nothing parked its message bound to a
PEER's plan and the intended recipient was refused (measured 2026-11-04,
message ``862ab6c6``). These columns hold each session's own declared plan.

They sit on ``coord.agent_sessions`` rather than ``coord.sessions`` because a
proven session id IS an ``agent_sessions`` id; ``coord.sessions`` is the
runner's per-boot launch row, bridged only by ``claude_code_session_id``, and
its ``work_unit_slug`` is the runner's launch slug, which resume and search
readers depend on.

What writes it
==============

coord's ``agent_sessions::record_work_unit_context``, called by
``coord_declare_intent`` and ``coord_report_status`` for a PROVEN caller
session (never an anonymous mint), and only with a DATED work-unit slug.

What reads it
=============

coord's ``agent_sessions::work_unit_context``, at park time (the sender) and at
claim-acquire collection time (the holder). It honours the stamp only in its
own tenant and while younger than ``agent_status::STATUS_TTL``, and falls back
to the session's ``coord.sessions`` launch slug.

Semantics
=========

``NULL`` means the session never declared a dated work unit. The reader treats
it as NO context: the message parks unbound, which is the safe direction. No
default and no backfill -- a backfill would have to guess a session's plan,
which is the defect this revision exists to end.

Head choice
===========

``down_revision`` is the single head of ``origin/main`` at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). Re-point rule: if
another alembic revision lands first, re-point ``down_revision`` at land time;
the companion test's ``_PARENT_REVISION_ID`` literal moves with it.

Safety
======

All three columns are nullable with no default, so the ADD is catalogue-only
and rewrites no row. ``coord.agent_sessions`` is written by coord on every
session heartbeat, so the ACCESS EXCLUSIVE wait is bounded with
``SET LOCAL lock_timeout = '3s'`` and restored afterwards -- env.py runs the
whole upgrade batch in one transaction, so an unrestored ``SET LOCAL`` would
impose the ceiling on every later revision. Every SQL string is a static
literal, so the revision renders unchanged in offline ``--sql`` mode. Downgrade
drops the columns ``IF EXISTS``; the data does not return.

No index: the reader looks a row up by its primary key.

Merge-train classifier disposition
==================================

The lock bracket makes ``upgrade()`` unclassifiable to coord's migration
classifier, so an ``auto_if_provably_safe`` escalate policy covering this glob
returns Blocked rather than clearing -- the known price of the guard, as
``coord_agent_sessions_context_01`` documents.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_sessions_work_unit_context_01"
down_revision: str | Sequence[str] | None = "coord_test_result_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three nullable work-unit-context columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # IF NOT EXISTS matches on NAME only; acceptable because no revision in
    # this chain spells any of these columns on this table.
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            ADD COLUMN IF NOT EXISTS work_unit_context_slug TEXT,
            ADD COLUMN IF NOT EXISTS work_unit_context_tenant_id UUID,
            ADD COLUMN IF NOT EXISTS work_unit_context_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.work_unit_context_slug IS
            'The dated work-unit slug this session last declared via '
            'coord_declare_intent or coord_report_status. Written by coord '
            'agent_sessions::record_work_unit_context; read by coord '
            'agent_sessions::work_unit_context as the parked-message context (plan '
            '2026-11-04-a-parked-message-is-bound-to-a-peers-work-unit-when-that-peer-holds-the-devices-only-dated-intent). '
            'NULL = no declared plan; read as NO context.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.work_unit_context_tenant_id IS
            'The tenant work_unit_context_slug was declared in. Written by coord '
            'agent_sessions::record_work_unit_context; read by coord '
            'agent_sessions::work_unit_context, which honours the stamp only in '
            'this tenant (plan '
            '2026-11-04-a-parked-message-is-bound-to-a-peers-work-unit-when-that-peer-holds-the-devices-only-dated-intent). '
            'NULL = no declared plan; read as NO context.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.work_unit_context_at IS
            'When work_unit_context_slug was last declared. Written by coord '
            'agent_sessions::record_work_unit_context; read by coord '
            'agent_sessions::work_unit_context, which honours the stamp only '
            'while it is younger than the agent_status TTL (plan '
            '2026-11-04-a-parked-message-is-bound-to-a-peers-work-unit-when-that-peer-holds-the-devices-only-dated-intent). '
            'NULL = no declared plan; read as NO context.'
        """
    )

    # env.py runs the whole batch in one transaction, so leaving this set would
    # silently impose a 3 s ceiling on the next revision's DDL too.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the three columns (a catalogue inverse; the data does not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            DROP COLUMN IF EXISTS work_unit_context_at,
            DROP COLUMN IF EXISTS work_unit_context_tenant_id,
            DROP COLUMN IF EXISTS work_unit_context_slug
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")
