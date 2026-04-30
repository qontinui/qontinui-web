"""consolidation phase2 v_08 recordings + recording_actions + recording_exports

Revision ID: consolidation_phase2_v_08_recordings
Revises: consolidation_phase2_v_07_verification_tests_test_results
Create Date: 2026-04-29

Phase 2, v8: create recording library tables.

Source: ``mod.rs:288-344``.

On fresh canonical DB: NO-OP. Phase 1 batch 15 created all three.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_08_recordings"
down_revision: str = "consolidation_phase2_v_07_verification_tests_test_results"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS recordings (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            base_url TEXT NOT NULL,
            action_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'recording',
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            duration_ms INTEGER,
            browser_info TEXT,
            tab_id INTEGER,
            tags TEXT DEFAULT '[]',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
        CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at);
        CREATE INDEX IF NOT EXISTS idx_recordings_base_url ON recordings(base_url);

        CREATE TABLE IF NOT EXISTS recording_actions (
            id TEXT PRIMARY KEY,
            recording_id TEXT NOT NULL,
            sequence_number INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            url TEXT NOT NULL,
            page_title TEXT,
            target_json TEXT NOT NULL,
            action_data_json TEXT,
            screenshot_path TEXT,
            timestamp TEXT NOT NULL,
            duration_ms INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recording_actions_recording_id ON recording_actions(recording_id);
        CREATE INDEX IF NOT EXISTS idx_recording_actions_sequence ON recording_actions(recording_id, sequence_number);
        CREATE INDEX IF NOT EXISTS idx_recording_actions_action_type ON recording_actions(action_type);

        CREATE TABLE IF NOT EXISTS recording_exports (
            id TEXT PRIMARY KEY,
            recording_id TEXT NOT NULL,
            export_format TEXT NOT NULL,
            script_content TEXT NOT NULL,
            file_name TEXT NOT NULL,
            options_json TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recording_exports_recording_id ON recording_exports(recording_id);
        CREATE INDEX IF NOT EXISTS idx_recording_exports_format ON recording_exports(export_format);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS recording_exports CASCADE")
    op.execute("DROP TABLE IF EXISTS recording_actions CASCADE")
    op.execute("DROP TABLE IF EXISTS recordings CASCADE")
