"""coord.agent_logs (Phase 5 substrate)

Revision ID: coord_agent_logs
Revises: coord_agent_questions
Create Date: 2026-05-19

Phase 5 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

Stands up ``coord.agent_logs``: the durable structured-log stream for
all agent runs. Each row is one structured event the agent emitted
(level + event tag + JSONB payload). The operator dashboard's "tail
agent logs" view reads from here, filtered by agent_id / session_id.

Schema:

* ``log_id UUID PRIMARY KEY``        — synthetic id.
* ``agent_id UUID NOT NULL``         — the emitting agent. Not FK'd —
  see ``coord_agent_questions`` for the rationale (agent identity
  survives session rotation).
* ``agent_session_id UUID``          — best-effort link to a session.
* ``device_id UUID``                 — best-effort link to the device
  hosting the agent.
* ``level TEXT NOT NULL``            — ``trace|debug|info|warn|error``.
  TEXT-not-enum so adding levels stays a no-op migration.
* ``event TEXT NOT NULL``            — short tag, e.g. ``"phase_start"``,
  ``"tool_call"``, ``"verification_failed"``. Dashboards group by this.
* ``payload JSONB``                  — full structured event body. The
  agent decides shape per event tag; readers MUST tolerate unknown
  fields.
* ``occurred_at TIMESTAMPTZ``        — when the agent emitted the
  event (NOT when this row was inserted; the publisher batches).

Indices:

* ``idx_agent_logs_agent``           — per-agent timeline.
* ``idx_agent_logs_session``         — per-session timeline (partial,
  skips out-of-session events to keep the index small).
* ``idx_agent_logs_recent``          — global "newest events" feed
  for the operator dashboard's home tile.

Retention: handled by a later phase (likely a daily DELETE-by-age job).
Not encoded in schema so retention policy can be tuned without a
migration.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS``. Runtime self-heal posture per
[[feedback_canonical_db_behind_alembic]].

Chains off ``coord_agent_questions`` (Phase 3).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_agent_logs"
down_revision: str = "coord_agent_questions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.agent_logs`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_logs (
            log_id            UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            agent_id          UUID NOT NULL,
            agent_session_id  UUID,
            device_id         UUID,
            level             TEXT NOT NULL,
            event             TEXT NOT NULL,
            payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
            occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_logs_agent
            ON coord.agent_logs(agent_id, occurred_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_logs_session
            ON coord.agent_logs(agent_session_id, occurred_at DESC)
            WHERE agent_session_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_logs_recent
            ON coord.agent_logs(occurred_at DESC)
        """
    )


def downgrade() -> None:
    """Drop ``coord.agent_logs`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_logs_recent")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_logs_session")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_logs_agent")
    op.execute("DROP TABLE IF EXISTS coord.agent_logs")
