"""consolidation phase2 v_20 runner-schema consolidation (NO-OP)

Revision ID: consolidation_phase2_v_20_consolidate_runner_schema_noop
Revises: consolidation_phase2_v_19_max_iterations_unlimited
Create Date: 2026-04-29

Phase 2, v20: TRUE NO-OP.

Source: ``mod.rs:816-857``. Original purpose: drop public.* duplicates
of runner.* tables, then ALTER public-only tables SET SCHEMA runner.

Why no-op in canonical world: Phase 1 created every table directly in
its final schema (project / coord / agent / auth) per the schema
mapping in the plan. There is no ``runner`` schema and no ``public.*``
duplicates to consolidate. The historical runner-schema consolidation
problem this migration solved doesn't exist in the canonical-DB
topology.

Re-authored as a documented no-op for chain continuity. The DROP TABLE
+ SET SCHEMA dance from the source would be either harmful (if it
matched anything) or pointless (if it matched nothing) on canonical
DB; a true no-op is the only correct port.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_20_consolidate_runner_schema_noop"
down_revision: str = "consolidation_phase2_v_19_max_iterations_unlimited"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
