"""consolidation phase2 v_04 entity_profiles

Revision ID: consolidation_phase2_v_04_entity_profiles
Revises: consolidation_phase2_v_03_contradiction_resolutions
Create Date: 2026-04-29

Phase 2, v4: create ``project.entity_profiles`` table.

Source: ``mod.rs:156-190``. Honcho-inspired evolving representation
(per-entity decaying-importance summary with FTS).

On fresh canonical DB: NO-OP. Phase 1 batch 20 already created
``project.entity_profiles`` with this shape including the GIN FTS
index.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_04_entity_profiles"
down_revision: str = "consolidation_phase2_v_03_contradiction_resolutions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_profiles (
            id BIGSERIAL PRIMARY KEY,
            entity_kind TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            entity_label TEXT NOT NULL,
            profile_summary TEXT NOT NULL,
            profile_detail TEXT,
            topic_key TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            decay_rate DOUBLE PRECISION NOT NULL DEFAULT 0.02,
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed_at TIMESTAMPTZ,
            revision_count INTEGER NOT NULL DEFAULT 1,
            source_observation_ids BIGINT[],
            source_finding_ids TEXT[],
            source_fix_ids TEXT[],
            source_cross_run_pattern_ids TEXT[],
            valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            valid_until TIMESTAMPTZ,
            superseded_by BIGINT REFERENCES entity_profiles(id),
            is_deleted BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ep_entity ON entity_profiles(entity_kind, entity_id) WHERE NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_ep_topic_key ON entity_profiles(topic_key) WHERE NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_ep_importance ON entity_profiles(importance) WHERE NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_ep_fts ON entity_profiles USING GIN (to_tsvector('english', entity_label || ' ' || profile_summary)) WHERE NOT is_deleted;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS entity_profiles CASCADE")
