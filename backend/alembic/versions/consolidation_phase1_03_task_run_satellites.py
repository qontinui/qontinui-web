"""consolidation phase1 03 task_run satellites

Revision ID: consolidation_phase1_03_task_run_satellites
Revises: consolidation_phase1_02_task_runs
Create Date: 2026-04-29

Phase 1, batch 3 of the migration consolidation.

Creates the eight satellite tables that FK-reference
``project.task_runs``:

- ``project.phase_token_usage`` — per-phase token spend.
- ``project.task_run_events`` — unified event log (highest write
  frequency; integer surrogate PK).
- ``project.task_run_screenshots`` — screenshots tied to events.
- ``project.task_run_playwright_results`` — Playwright test artifacts.
- ``project.task_run_api_requests`` — captured HTTP requests.
- ``project.task_run_awas_steps`` — AWAS step execution rows.
- ``project.execution_spans`` — OpenTelemetry-compatible trace spans.
- ``project.execution_state_snapshots`` — per-span state snapshots
  (no explicit FK in source — preserved as plain ``TEXT``).

Source: ``schema.pg.sql:127-309``.

All FK references use ``ondelete='CASCADE'`` (matching source) except
``task_run_screenshots.event_id`` → ``task_run_events.id``, which is
``ondelete='SET NULL'`` (matching source).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_03_task_run_satellites"
down_revision: str = "consolidation_phase1_02_task_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # phase_token_usage
    op.create_table(
        "phase_token_usage",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("stage_index", sa.Integer(), nullable=True),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column("provider_used", sa.Text(), nullable=True),
        sa.Column(
            "input_tokens",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "output_tokens",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "cost_cents",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column(
            "cache_creation_tokens",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "cache_read_tokens",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("target_app", sa.Text(), nullable=True),
        sa.Column("target_page_url", sa.Text(), nullable=True),
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
        "idx_ptu_task_run", "phase_token_usage", ["task_run_id"], schema="project"
    )
    op.create_index(
        "idx_ptu_created_at",
        "phase_token_usage",
        ["created_at"],
        schema="project",
    )
    op.create_index(
        "idx_ptu_target_app",
        "phase_token_usage",
        ["target_app"],
        schema="project",
        postgresql_where=sa.text("target_app IS NOT NULL"),
    )

    # task_run_events
    op.create_table(
        "task_run_events",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("event_subtype", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("data", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("state_name", sa.Text(), nullable=True),
        sa.Column("action_id", sa.Text(), nullable=True),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_tre_task_run_id",
        "task_run_events",
        ["task_run_id"],
        schema="project",
    )
    op.create_index(
        "idx_tre_event_type",
        "task_run_events",
        ["event_type"],
        schema="project",
    )
    op.create_index(
        "idx_tre_timestamp",
        "task_run_events",
        ["timestamp"],
        schema="project",
    )
    op.create_index(
        "idx_tre_subtype",
        "task_run_events",
        ["event_subtype"],
        schema="project",
    )
    op.create_index(
        "idx_tre_workflow",
        "task_run_events",
        ["workflow_name"],
        schema="project",
    )

    # task_run_screenshots (depends on task_run_events.id existing — created above)
    op.create_table(
        "task_run_screenshots",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            sa.BigInteger(),
            sa.ForeignKey("project.task_run_events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("screenshot_type", sa.Text(), nullable=False),
        sa.Column("template_name", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("match_location", sa.Text(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
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
        "idx_trs_task_run_id",
        "task_run_screenshots",
        ["task_run_id"],
        schema="project",
    )
    op.create_index(
        "idx_trs_type",
        "task_run_screenshots",
        ["screenshot_type"],
        schema="project",
    )

    # task_run_playwright_results
    op.create_table(
        "task_run_playwright_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("test_name", sa.Text(), nullable=False),
        sa.Column("spec_file", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("stdout", sa.Text(), nullable=True),
        sa.Column("stderr", sa.Text(), nullable=True),
        sa.Column("console_output", sa.Text(), nullable=True),
        sa.Column("page_snapshot", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("failure_screenshot_path", sa.Text(), nullable=True),
        sa.Column(
            "assertions_passed",
            sa.Integer(),
            nullable=True,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "assertions_failed",
            sa.Integer(),
            nullable=True,
            server_default=sa.text("0"),
        ),
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
        "idx_trp_task_run_id",
        "task_run_playwright_results",
        ["task_run_id"],
        schema="project",
    )
    op.create_index(
        "idx_trp_status",
        "task_run_playwright_results",
        ["status"],
        schema="project",
    )

    # task_run_api_requests
    op.create_table(
        "task_run_api_requests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_id", sa.Text(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=True),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("resolved_url", sa.Text(), nullable=False),
        sa.Column("request_headers", sa.Text(), nullable=True),
        sa.Column("request_body", sa.Text(), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("status_text", sa.Text(), nullable=True),
        sa.Column("response_headers", sa.Text(), nullable=True),
        sa.Column("response_time_ms", sa.BigInteger(), nullable=False),
        sa.Column("response_body_type", sa.Text(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("response_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("extractions", sa.Text(), nullable=True),
        sa.Column("assertions", sa.Text(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
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
        "idx_trar_task_run_id",
        "task_run_api_requests",
        ["task_run_id"],
        schema="project",
    )
    op.create_index(
        "idx_trar_step_id",
        "task_run_api_requests",
        ["step_id"],
        schema="project",
    )
    op.create_index(
        "idx_trar_created_at",
        "task_run_api_requests",
        ["created_at"],
        schema="project",
    )

    # task_run_awas_steps
    op.create_table(
        "task_run_awas_steps",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_id", sa.Text(), nullable=True),
        sa.Column("step_name", sa.Text(), nullable=True),
        sa.Column("step_type", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("action_id", sa.Text(), nullable=True),
        sa.Column("parameters", sa.Text(), nullable=True),
        sa.Column("response_data", sa.Text(), nullable=True),
        sa.Column(
            "success",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
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
        "idx_traw_task_run_id",
        "task_run_awas_steps",
        ["task_run_id"],
        schema="project",
    )
    op.create_index(
        "idx_traw_step_type",
        "task_run_awas_steps",
        ["step_type"],
        schema="project",
    )

    # execution_spans (OpenTelemetry-compatible)
    op.create_table(
        "execution_spans",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("trace_id", sa.Text(), nullable=False),
        sa.Column("span_id", sa.Text(), nullable=False),
        sa.Column("parent_span_id", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("start_ts", sa.Text(), nullable=False),
        sa.Column("end_ts", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("attributes", sa.Text(), nullable=True),
        sa.Column(
            "success",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        # Inngest-inspired enrichment (v146)
        sa.Column("queue_wait_ms", sa.BigInteger(), nullable=True),
        sa.Column("retry_attempt", sa.Integer(), nullable=True),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        # Token usage and cost tracking (v168)
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_cents", sa.Integer(), nullable=True),
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
        "idx_spans_execution",
        "execution_spans",
        ["execution_id"],
        schema="project",
    )
    op.create_index(
        "idx_spans_trace", "execution_spans", ["trace_id"], schema="project"
    )
    op.create_index(
        "idx_spans_name", "execution_spans", ["name"], schema="project"
    )

    # execution_state_snapshots — note: source has no FK on execution_id
    # (preserved as plain TEXT NOT NULL).
    op.create_table(
        "execution_state_snapshots",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("execution_id", sa.Text(), nullable=False),
        sa.Column(
            "span_id",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column(
            "snapshot_ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("state_type", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("context_json", sa.Text(), nullable=True),
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
        "idx_ess_execution",
        "execution_state_snapshots",
        ["execution_id"],
        schema="project",
    )
    op.create_index(
        "idx_ess_ts",
        "execution_state_snapshots",
        ["snapshot_ts"],
        schema="project",
    )


def downgrade() -> None:
    # Drop in reverse order of upgrade (children before parents).
    op.drop_index(
        "idx_ess_ts",
        table_name="execution_state_snapshots",
        schema="project",
    )
    op.drop_index(
        "idx_ess_execution",
        table_name="execution_state_snapshots",
        schema="project",
    )
    op.drop_table("execution_state_snapshots", schema="project")

    op.drop_index(
        "idx_spans_name", table_name="execution_spans", schema="project"
    )
    op.drop_index(
        "idx_spans_trace", table_name="execution_spans", schema="project"
    )
    op.drop_index(
        "idx_spans_execution", table_name="execution_spans", schema="project"
    )
    op.drop_table("execution_spans", schema="project")

    op.drop_index(
        "idx_traw_step_type",
        table_name="task_run_awas_steps",
        schema="project",
    )
    op.drop_index(
        "idx_traw_task_run_id",
        table_name="task_run_awas_steps",
        schema="project",
    )
    op.drop_table("task_run_awas_steps", schema="project")

    op.drop_index(
        "idx_trar_created_at",
        table_name="task_run_api_requests",
        schema="project",
    )
    op.drop_index(
        "idx_trar_step_id",
        table_name="task_run_api_requests",
        schema="project",
    )
    op.drop_index(
        "idx_trar_task_run_id",
        table_name="task_run_api_requests",
        schema="project",
    )
    op.drop_table("task_run_api_requests", schema="project")

    op.drop_index(
        "idx_trp_status",
        table_name="task_run_playwright_results",
        schema="project",
    )
    op.drop_index(
        "idx_trp_task_run_id",
        table_name="task_run_playwright_results",
        schema="project",
    )
    op.drop_table("task_run_playwright_results", schema="project")

    op.drop_index(
        "idx_trs_type", table_name="task_run_screenshots", schema="project"
    )
    op.drop_index(
        "idx_trs_task_run_id",
        table_name="task_run_screenshots",
        schema="project",
    )
    op.drop_table("task_run_screenshots", schema="project")

    op.drop_index(
        "idx_tre_workflow", table_name="task_run_events", schema="project"
    )
    op.drop_index(
        "idx_tre_subtype", table_name="task_run_events", schema="project"
    )
    op.drop_index(
        "idx_tre_timestamp", table_name="task_run_events", schema="project"
    )
    op.drop_index(
        "idx_tre_event_type", table_name="task_run_events", schema="project"
    )
    op.drop_index(
        "idx_tre_task_run_id", table_name="task_run_events", schema="project"
    )
    op.drop_table("task_run_events", schema="project")

    op.drop_index(
        "idx_ptu_target_app",
        table_name="phase_token_usage",
        schema="project",
    )
    op.drop_index(
        "idx_ptu_created_at",
        table_name="phase_token_usage",
        schema="project",
    )
    op.drop_index(
        "idx_ptu_task_run", table_name="phase_token_usage", schema="project"
    )
    op.drop_table("phase_token_usage", schema="project")
