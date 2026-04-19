"""add phase_results table

Revision ID: 6b3fb9585492
Revises: 60801728f43e
Create Date: 2026-04-19 21:23:04.227743

Phase 3B of restate-port-part-b-server-runner:

* Add ``phase_results`` — one row per workflow-phase completion emitted by a
  server-mode runner. Mirrors the runner-side ``PhaseResult`` struct.
* Two composite indexes for the common timeline / per-runner-history queries.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "6b3fb9585492"
down_revision: Union[str, None] = "60801728f43e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "phase_results",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "runner_id",
            sa.UUID(),
            nullable=True,
            comment=(
                "Runner fleet id that produced this phase result (nullable so "
                "history is preserved after a runner is deregistered)."
            ),
        ),
        sa.Column(
            "execution_id",
            sa.String(length=255),
            nullable=False,
            comment="Runner-generated execution identifier the phase belongs to.",
        ),
        sa.Column(
            "phase",
            sa.String(length=32),
            nullable=False,
            comment="'setup' | 'verification' | 'agentic' | 'completion'",
        ),
        sa.Column(
            "iteration",
            sa.Integer(),
            nullable=True,
            comment="Iteration number (NULL for setup/completion).",
        ),
        sa.Column(
            "stage_index",
            sa.Integer(),
            nullable=True,
            comment="Stage index for multi-stage workflows (NULL = single-stage).",
        ),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("all_passed", sa.Boolean(), nullable=False),
        sa.Column(
            "duration_ms",
            sa.BigInteger(),
            nullable=False,
            comment="Phase duration in milliseconds.",
        ),
        sa.Column("failure_context", sa.Text(), nullable=True),
        sa.Column(
            "commit_hash",
            sa.String(length=64),
            nullable=True,
            comment="Git commit hash at end of phase (compensation correlation).",
        ),
        sa.Column(
            "step_results",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="Per-step results (list of StepResultRecord JSON objects).",
        ),
        sa.Column(
            "variables_set",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Variables set during this phase (NULL = not captured).",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["runner_id"],
            ["runners.id"],
            name=op.f("phase_results_runner_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("phase_results_pkey")),
    )
    op.create_index(
        op.f("ix_phase_results_execution_id"),
        "phase_results",
        ["execution_id"],
        unique=False,
    )
    op.create_index(
        "ix_phase_results_execution_id_created_at",
        "phase_results",
        ["execution_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_phase_results_runner_id_created_at",
        "phase_results",
        ["runner_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_phase_results_runner_id_created_at", table_name="phase_results"
    )
    op.drop_index(
        "ix_phase_results_execution_id_created_at", table_name="phase_results"
    )
    op.drop_index(
        op.f("ix_phase_results_execution_id"), table_name="phase_results"
    )
    op.drop_table("phase_results")
