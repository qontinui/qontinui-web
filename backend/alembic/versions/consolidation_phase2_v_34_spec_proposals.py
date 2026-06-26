"""consolidation phase2 v_34 spec_proposals table

Revision ID: consolidation_phase2_v_34_spec_proposals
Revises: consolidation_phase2_zz_final_runner_cleanup
Create Date: 2026-06-26

Phase 2, v34: create spec_proposals table for Stream E (Flywheel) coverage-growth queue.

This table tracks proposals for full-page or patch specs that are queued for
authoring/validation. It is the heart of the flywheel feedback loop that drives
continuous spec coverage improvements.

The table includes:
- id: Primary key (text, unique proposal ID)
- kind: 'fullPage' or 'patch' (checked via constraint)
- pathname: Target pathname for fullPage specs (nullable)
- spec_id: Target spec_id for patch specs (nullable)
- status: Current state ('queued', 'in-flight', 'validating', 'promoted', 'failed')
- created_at: Timestamp of proposal creation
- last_attempt_at: Timestamp of last attempt (nullable)
- consecutive_greens: Counter for successful validations (defaults to 0)
- last_error: Error message from last failed attempt (nullable)
- candidate_ir: Proposed IR spec (nullable, JSONB)
- metadata: Additional metadata (defaults to {}, JSONB)

Dedup via unique functional index on (kind, COALESCE(pathname, spec_id))
to prevent multiple queued proposals for the same target.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_34_spec_proposals"
down_revision: str = "consolidation_phase2_zz_final_runner_cleanup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS spec_proposals (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('fullPage', 'patch')),
            pathname TEXT,
            spec_id TEXT,
            status TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_attempt_at TIMESTAMPTZ,
            consecutive_greens INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            candidate_ir JSONB,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE UNIQUE INDEX IF NOT EXISTS spec_proposals_kind_target_uniq
            ON spec_proposals (kind, COALESCE(pathname, spec_id));
        CREATE INDEX IF NOT EXISTS spec_proposals_status_idx
            ON spec_proposals (status);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS spec_proposals CASCADE")
