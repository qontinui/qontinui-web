"""coord.agent_questions (Phase 3 substrate)

Revision ID: coord_agent_questions
Revises: coord_plans
Create Date: 2026-05-19

Phase 3 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

Stands up ``coord.agent_questions``: the durable backing store for the
"agent asks operator a question" surface. Agents POST a row when they
hit an ``AskUserQuestion`` checkpoint; the operator dashboard reads
pending rows (``responded_at IS NULL``) and writes the answer back.

Schema:

* ``question_id UUID PRIMARY KEY``    — synthetic id; what the agent
  awaits.
* ``agent_id UUID NOT NULL``          — the asking agent. Not FK'd
  because agent identity lives in ``coord.agent_sessions`` /
  ``coord.devices`` and we want this table to survive agent rotation.
* ``agent_session_id UUID``           — best-effort link to the
  agent session row; NULL when the agent runs outside a session.
* ``device_id UUID``                  — best-effort link to the device
  hosting the agent.
* ``plan_phase TEXT``                 — free-form context, e.g.
  ``"2026-05-19-coordinator-production-readiness Phase 4"``.
* ``question TEXT NOT NULL``          — the question text the operator
  sees.
* ``options JSONB NOT NULL``          — array of structured options; the
  dashboard renders these as buttons. Empty array = free-form text
  response. JSONB so a future revision can attach per-option metadata
  (recommended, danger, default) without a migration.
* ``context TEXT``                    — extended context the agent
  wants the operator to read before deciding.
* ``created_at TIMESTAMPTZ``          — when the agent asked.
* ``responded_at TIMESTAMPTZ``        — when the operator answered;
  NULL means still pending.
* ``response TEXT``                   — the answer (option key or
  free-form text).
* ``responded_by_operator TEXT``      — operator email / display name.

Indices:

* ``idx_agent_questions_pending``     — partial index on
  ``responded_at IS NULL`` ordered by ``created_at DESC``. This is the
  dashboard's hot read path: "show me what's waiting on me." Partial
  index keeps it small as answered questions accumulate.
* ``idx_agent_questions_session``     — partial index on session id
  for the agent-session detail view's per-session question list.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS``. Runtime self-heal will live alongside the question API
handler per the [[feedback_canonical_db_behind_alembic]] posture.

Chains off ``coord_plans`` (Phase 2).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions"
down_revision: str = "coord_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.agent_questions`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_questions (
            question_id            UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            agent_id               UUID NOT NULL,
            agent_session_id       UUID,
            device_id              UUID,
            plan_phase             TEXT,
            question               TEXT NOT NULL,
            options                JSONB NOT NULL,
            context                TEXT,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            responded_at           TIMESTAMPTZ,
            response               TEXT,
            responded_by_operator  TEXT
        )
        """
    )
    # Dashboard hot path: pending questions, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_questions_pending
            ON coord.agent_questions(created_at DESC)
            WHERE responded_at IS NULL
        """
    )
    # Per-session timeline lookup.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_questions_session
            ON coord.agent_questions(agent_session_id)
            WHERE agent_session_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.agent_questions`` + indices."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_agent_questions_session"
    )
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_agent_questions_pending"
    )
    op.execute("DROP TABLE IF EXISTS coord.agent_questions")
