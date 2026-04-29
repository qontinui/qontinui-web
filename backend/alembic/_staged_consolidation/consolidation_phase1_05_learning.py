"""consolidation phase1 05 learning

Revision ID: consolidation_phase1_05_learning
Revises: consolidation_phase1_04_workflows
Create Date: 2026-04-29

Phase 1, batch 5 of the migration consolidation.

Creates the learning + Q-routing tables in ``project``:

- ``project.learning_outcomes`` — task execution results for the
  meta-optimizer.
- ``project.learning_patterns`` — identified patterns from task
  analysis.
- ``project.q_routing_table`` — Q-learning state-action values for
  architecture routing (composite PK: ``state_key`` + ``action``).
- ``project.q_routing_overrides`` — manual locks forcing a state to
  use a specific architecture.

Source: ``schema.pg.sql:453-518``.

These tables have no FK references to other batches — ordering is
relaxed but kept after batch 4 to preserve the schema.pg.sql narrative
order.

Notable details:
- ``context_embedding`` and ``description_embedding`` are ``BYTEA``
  (1536 bytes = 384 × f32 LE), preserving runner-native fidelity.
  Conversion to ``vector(N)`` columns is a separate future cleanup.
- ``q_routing_table`` has a composite primary key
  ``(state_key, action)`` rather than a surrogate ID.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_05_learning"
down_revision: str = "consolidation_phase1_04_workflows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # learning_outcomes
    op.create_table(
        "learning_outcomes",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("duration_secs", sa.Float(), nullable=True),
        sa.Column("iterations", sa.Integer(), nullable=True),
        sa.Column("strategy", sa.Text(), nullable=True),
        sa.Column("tools_used", sa.Text(), nullable=True),
        sa.Column("files_modified", sa.Text(), nullable=True),
        sa.Column("error_type", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("workflow_architecture", sa.Text(), nullable=True),
        sa.Column("context_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("step_count", sa.BigInteger(), nullable=True),
        sa.Column("verification_step_count", sa.BigInteger(), nullable=True),
        sa.Column("agentic_step_count", sa.BigInteger(), nullable=True),
        sa.Column(
            "has_ui_bridge",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column("total_tokens", sa.BigInteger(), nullable=True),
        sa.Column("total_cost_usd", sa.Float(), nullable=True),
        sa.Column("composite_agentic_score", sa.Float(), nullable=True),
        sa.Column("technology_tags", sa.Text(), nullable=True),
        sa.Column("domain_tags", sa.Text(), nullable=True),
        sa.Column("complexity_tier", sa.Text(), nullable=True),
        # DAG workflows (v17)
        sa.Column("dag_node_metrics", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_lo_task_id", "learning_outcomes", ["task_id"], schema="project"
    )
    op.create_index(
        "idx_lo_status", "learning_outcomes", ["status"], schema="project"
    )
    op.create_index(
        "idx_lo_created_at",
        "learning_outcomes",
        ["created_at"],
        schema="project",
    )
    op.create_index(
        "idx_lo_strategy",
        "learning_outcomes",
        ["strategy"],
        schema="project",
    )

    # learning_patterns
    op.create_table(
        "learning_patterns",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("pattern_type", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column(
            "occurrences",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("context", sa.Text(), nullable=True),
        sa.Column("description_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_lp_type",
        "learning_patterns",
        ["pattern_type"],
        schema="project",
    )
    op.create_index(
        "idx_lp_confidence",
        "learning_patterns",
        ["confidence"],
        schema="project",
    )

    # q_routing_table (composite PK)
    op.create_table(
        "q_routing_table",
        sa.Column("state_key", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column(
            "q_value",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        sa.Column(
            "visit_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "last_updated",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("state_key", "action"),
        schema="project",
    )

    # q_routing_overrides
    op.create_table(
        "q_routing_overrides",
        sa.Column("state_key", sa.Text(), nullable=False),
        sa.Column("forced_action", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("state_key"),
        schema="project",
    )


def downgrade() -> None:
    op.drop_table("q_routing_overrides", schema="project")
    op.drop_table("q_routing_table", schema="project")

    op.drop_index(
        "idx_lp_confidence",
        table_name="learning_patterns",
        schema="project",
    )
    op.drop_index(
        "idx_lp_type", table_name="learning_patterns", schema="project"
    )
    op.drop_table("learning_patterns", schema="project")

    op.drop_index(
        "idx_lo_strategy",
        table_name="learning_outcomes",
        schema="project",
    )
    op.drop_index(
        "idx_lo_created_at",
        table_name="learning_outcomes",
        schema="project",
    )
    op.drop_index(
        "idx_lo_status", table_name="learning_outcomes", schema="project"
    )
    op.drop_index(
        "idx_lo_task_id", table_name="learning_outcomes", schema="project"
    )
    op.drop_table("learning_outcomes", schema="project")
