"""consolidation phase2 v_12 drop SQLite-era orphan tables

Revision ID: consolidation_phase2_v_12_drop_orphan_tables
Revises: consolidation_phase2_v_11_missing_columns
Create Date: 2026-04-29

Phase 2, v12: drop 10 orphan tables left over from the SQLite -> PG
migration that have zero Rust references.

Source: ``mod.rs:607-651``.

Tables dropped:
- api_credentials, api_request_logs (never-shipped API key UI)
- context_summaries (replaced by task_knowledge_summaries)
- decomposition_plans, decomposition_subtasks (PentAGI; never built)
- generator_benchmarks, generator_benchmark_results (deleted with eval rewrite)
- rule_applications (superseded by graph_engine_pg)
- schema_version (SQLite migration tracker; replaced by alembic_version)
- ui_bridge_state_groups (never-shipped state grouping UI)

On fresh canonical DB: NO-OP. None of these tables are created by
Phase 1. ``DROP TABLE IF EXISTS`` is idempotent.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_12_drop_orphan_tables"
down_revision: str = "consolidation_phase2_v_11_missing_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DROP TABLE IF EXISTS api_credentials CASCADE;
        DROP TABLE IF EXISTS api_request_logs CASCADE;
        DROP TABLE IF EXISTS context_summaries CASCADE;
        DROP TABLE IF EXISTS decomposition_subtasks CASCADE;
        DROP TABLE IF EXISTS decomposition_plans CASCADE;
        DROP TABLE IF EXISTS generator_benchmark_results CASCADE;
        DROP TABLE IF EXISTS generator_benchmarks CASCADE;
        DROP TABLE IF EXISTS rule_applications CASCADE;
        DROP TABLE IF EXISTS schema_version CASCADE;
        DROP TABLE IF EXISTS ui_bridge_state_groups CASCADE;
        """
    )


def downgrade() -> None:
    pass
