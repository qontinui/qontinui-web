"""consolidation phase2 v_24 co-occurrence observation pipeline

Revision ID: consolidation_phase2_v_24_co_occurrence
Revises: consolidation_phase2_v_23_htn_columns
Create Date: 2026-04-29

Phase 2, v24: create co-occurrence observation pipeline tables —
``co_occurrence_observations``, ``state_discovery_artifacts``,
``state_discovery_drift_scores`` — all in ``project``.

Source: ``mod.rs:908-955``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created all three.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_24_co_occurrence"
down_revision: str = "consolidation_phase2_v_23_htn_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS co_occurrence_observations (
            id UUID PRIMARY KEY,
            captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            spec_id TEXT,
            runner_instance TEXT,
            fingerprints JSONB NOT NULL,
            snapshot_metadata JSONB,
            invalidated_at TIMESTAMPTZ,
            invalidated_reason TEXT,
            invalidated_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_observations_captured_at
            ON co_occurrence_observations (captured_at)
            WHERE invalidated_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_observations_spec
            ON co_occurrence_observations (spec_id, captured_at)
            WHERE invalidated_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_observations_fingerprints
            ON co_occurrence_observations USING gin(fingerprints);

        CREATE TABLE IF NOT EXISTS state_discovery_artifacts (
            id UUID PRIMARY KEY,
            spec_id TEXT,
            derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_days INTEGER NOT NULL,
            artifact JSONB NOT NULL,
            observation_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_discovery_spec_derived
            ON state_discovery_artifacts (spec_id, derived_at DESC);

        CREATE TABLE IF NOT EXISTS state_discovery_drift_scores (
            id BIGSERIAL PRIMARY KEY,
            spec_id TEXT,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_size INTEGER NOT NULL,
            fit_score DOUBLE PRECISION NOT NULL,
            observations_considered INTEGER NOT NULL,
            states_matched INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_drift_scores_spec_computed
            ON state_discovery_drift_scores (spec_id, computed_at DESC);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS state_discovery_drift_scores CASCADE")
    op.execute("DROP TABLE IF EXISTS state_discovery_artifacts CASCADE")
    op.execute("DROP TABLE IF EXISTS co_occurrence_observations CASCADE")
