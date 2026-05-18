"""add recording_pipeline_runs table

Revision ID: rp01_add_recording_pipeline_runs
Revises: wt01_workflow_triggers_workflow_id_nullable
Create Date: 2026-05-18

Phase 4 of plan 2026-05-17-web-runner-ws-bridge-plan-b.md.

Introduces the ``project.recording_pipeline_runs`` table that tracks
async recording-pipeline WS-bridge dispatches:

- ``POST /api/v1/recording-pipeline/process`` (et al.) insert a row in
  status ``queued`` and return 202 + ``run_id``.
- A background task on the web side awaits the runner's terminal
  response (via ``CommandRelayService.dispatch_and_wait`` with a long
  timeout) and updates the row to ``completed`` / ``failed`` with the
  serialised ``RecordingPipelineResult`` (or error payload).
- ``GET /api/v1/recording-pipeline/runs/{run_id}`` returns the row so
  clients can poll for completion.
- On web restart, a boot-time recovery scan re-spawns subscribers for
  any ``queued`` / ``running`` rows whose ``updated_at`` is within the
  last 30 minutes; older rows flip to ``timed_out``.

Index ``ix_recording_pipeline_runs_user_id_created`` supports the
per-user "my recent runs" lookup.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "rp01_add_recording_pipeline_runs"
down_revision: str = "wt01_workflow_triggers_workflow_id_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.recording_pipeline_runs (
            run_id UUID PRIMARY KEY,
            project_id UUID REFERENCES project.projects(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            runner_id UUID NOT NULL,
            command_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            progress_stage TEXT,
            progress_pct REAL,
            progress_message TEXT,
            result_json JSONB,
            error_json JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_recording_pipeline_runs_user_id_created
            ON project.recording_pipeline_runs (user_id, created_at DESC);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS project.ix_recording_pipeline_runs_user_id_created;
        """
    )
    op.execute(
        """
        DROP TABLE IF EXISTS project.recording_pipeline_runs;
        """
    )
