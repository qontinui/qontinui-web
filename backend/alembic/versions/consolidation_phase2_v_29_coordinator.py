"""consolidation phase2 v_29 coordinator_decisions + coordinator_leader

Revision ID: consolidation_phase2_v_29_coordinator
Revises: consolidation_phase2_v_28_productivity_plans_tasks
Create Date: 2026-04-29

Phase 2, v29: create ``coordinator_decisions`` and ``coordinator_leader``
tables in ``coord``.

Source: ``mod.rs:1081-1135``.

Targets ``coord`` per schema mapping. On fresh canonical DB: NO-OP
(Phase 1 batch 20 created both).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_29_coordinator"
down_revision: str = "consolidation_phase2_v_28_productivity_plans_tasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.coordinator_decisions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id      TEXT NOT NULL,
            iteration       BIGINT NOT NULL,
            rule            TEXT NOT NULL,
            action          TEXT NOT NULL,
            target_id       TEXT,
            reasoning       TEXT NOT NULL,
            auto_acted      BOOLEAN NOT NULL,
            resolved        BOOLEAN NOT NULL DEFAULT FALSE,
            resolution      TEXT,
            resolved_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_cd_session ON coord.coordinator_decisions(session_id);
        CREATE INDEX IF NOT EXISTS idx_cd_created ON coord.coordinator_decisions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cd_rule_action ON coord.coordinator_decisions(rule, action);
        CREATE INDEX IF NOT EXISTS idx_cd_open_escalations
            ON coord.coordinator_decisions(created_at DESC)
            WHERE resolved = FALSE AND auto_acted = FALSE
              AND action IN ('escalate', 'kill-session', 'force-promote-to-worktree');

        CREATE TABLE IF NOT EXISTS coord.coordinator_leader (
            id              BOOLEAN PRIMARY KEY DEFAULT TRUE
                            CHECK (id = TRUE),
            instance_id     TEXT NOT NULL,
            leased_until    TIMESTAMPTZ NOT NULL,
            acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            renewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.coordinator_leader CASCADE")
    op.execute("DROP TABLE IF EXISTS coord.coordinator_decisions CASCADE")
