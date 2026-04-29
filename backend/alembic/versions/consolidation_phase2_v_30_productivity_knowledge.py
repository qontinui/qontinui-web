"""consolidation phase2 v_30 productivity_knowledge + session_file_snapshots (CROSS-SCHEMA)

Revision ID: consolidation_phase2_v_30_productivity_knowledge
Revises: consolidation_phase2_v_29_coordinator
Create Date: 2026-04-29

Phase 2, v30: create ``productivity_knowledge`` (project) and
``session_file_snapshots`` (coord).

Source: ``mod.rs:1136-1183``.

CROSS-SCHEMA per mapping:
- ``project.productivity_knowledge`` — durable cross-session knowledge.
  FK ``task_id`` → ``coord.tasks(id)`` (cross-schema, SET NULL).
- ``coord.session_file_snapshots`` — visible across machines for
  /rewind-session.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created both tables in
their canonical schemas with the same FK shape.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_30_productivity_knowledge"
down_revision: str = "consolidation_phase2_v_29_coordinator"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.productivity_knowledge (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id         UUID REFERENCES coord.tasks(id) ON DELETE SET NULL,
            session_id      TEXT,
            area            TEXT NOT NULL,
            summary         TEXT NOT NULL,
            body            TEXT NOT NULL,
            embedding       BYTEA,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_pk_area ON project.productivity_knowledge(area);
        CREATE INDEX IF NOT EXISTS idx_pk_task ON project.productivity_knowledge(task_id) WHERE task_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_pk_session ON project.productivity_knowledge(session_id) WHERE session_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_pk_created ON project.productivity_knowledge(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pk_fts
            ON project.productivity_knowledge USING GIN (to_tsvector('english', area || ' ' || summary || ' ' || body));

        CREATE TABLE IF NOT EXISTS coord.session_file_snapshots (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id          TEXT NOT NULL,
            file_path           TEXT NOT NULL,
            snapshot_blob_path  TEXT NOT NULL,
            blob_sha256         TEXT NOT NULL,
            captured_before     BOOLEAN NOT NULL,
            taken_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_sfs_session ON coord.session_file_snapshots(session_id);
        CREATE INDEX IF NOT EXISTS idx_sfs_session_file ON coord.session_file_snapshots(session_id, file_path);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.session_file_snapshots CASCADE")
    op.execute("DROP TABLE IF EXISTS project.productivity_knowledge CASCADE")
