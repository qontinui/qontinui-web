"""add arq_job_id to training_jobs

Revision ID: add_arq_job_id_to_training_jobs
Revises: coordinator_phase_6_agent_coordination_hardening
Create Date: 2026-05-02

Adds the ``arq_job_id`` column to ``training_jobs`` so each row can be
correlated with its ARQ background-job entry.

Background: training is moving onto an ARQ worker queue. When a
``TrainingJob`` row transitions ``pending → queued`` the API enqueues an
ARQ job and stamps the returned job id here. The worker uses this id
(via the ARQ job-result store) to publish progress, and an aborting API
caller uses it to cancel the in-flight job. Indexed because the worker
callback path looks up the TrainingJob row by ``arq_job_id`` to update
``progress`` / ``current_epoch``.

VARCHAR(255) is wider than ARQ's typical 32-char hex job ids — leaves
headroom for prefixed / namespaced ids if we ever multi-tenant the
queue.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_arq_job_id_to_training_jobs"
down_revision: str = "section_5b_01_ui_bridge_causal_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "training_jobs",
        sa.Column("arq_job_id", sa.String(length=255), nullable=True),
        schema="project",
    )
    op.create_index(
        op.f("ix_training_jobs_arq_job_id"),
        "training_jobs",
        ["arq_job_id"],
        unique=False,
        schema="project",
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_training_jobs_arq_job_id"),
        table_name="training_jobs",
        schema="project",
    )
    op.drop_column("training_jobs", "arq_job_id", schema="project")
