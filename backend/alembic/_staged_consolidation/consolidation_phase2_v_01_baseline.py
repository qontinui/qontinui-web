"""consolidation phase2 v_01 baseline (no-op)

Revision ID: consolidation_phase2_v_01_baseline
Revises: consolidation_phase1_20_tail_specialty
Create Date: 2026-04-29

Phase 2, version 1 of the migration consolidation: baseline marker.

Source: ``mod.rs:118-123`` (``MIGRATIONS[0]``,
``description: "Baseline schema — marks existing tables as version 1"``).

The original runner-native v1 was an empty SQL marker: it stamped
``schema_migrations.version = 1`` to indicate that any tables created
by ``ensure_tables()`` were considered the "v1" baseline. With the
consolidation collapsing both systems into alembic, this marker is
redundant — ``alembic_version`` carries the same role. Re-authored
as a true no-op for chain-continuity / chronological fidelity.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_01_baseline"
down_revision: str = "consolidation_phase1_20_tail_specialty"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
