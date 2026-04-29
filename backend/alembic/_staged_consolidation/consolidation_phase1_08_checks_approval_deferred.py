"""consolidation phase1 08 checks / approval / deferred

Revision ID: consolidation_phase1_08_checks_approval_deferred
Revises: consolidation_phase1_07_stalls_shell_api
Create Date: 2026-04-29

Phase 1, batch 8: checks, approval, deferred-question, settings,
configs, and observations tables in ``project``.

- ``project.checks``, ``check_groups``, ``check_group_members`` —
  verification check definitions and groupings.
- ``project.user_skills`` — custom and auto-generated skill library.
- ``project.approval_gates`` — human-in-the-loop workflow approvals
  (FK → ``task_runs`` CASCADE).
- ``project.deferred_questions`` — non-blocking HITL feedback (FK →
  ``task_runs`` CASCADE; GIN FTS expression index).
- ``project.settings``, ``project.configs`` — kv stores.
- ``project.observations`` — Engram-inspired persistent memory; merges
  the canonical-schema columns + the post-creation ALTER TABLE
  additions (importance, last_accessed_at, access_count, decay_rate,
  consolidated_from, is_mental_model) into a single CREATE TABLE.
- ``project.memory_consolidation_log``, ``project.observation_history``
  — observation lifecycle infrastructure.

Source: ``schema.pg.sql:725-958``.

DRIFT FLAG (preserved): ``check_group_members.id`` is ``TEXT PRIMARY
KEY`` while the row is also constrained by ``UNIQUE(group_id, check_id)``
— the surrogate ``id`` is redundant. Preserved to match source.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_08_checks_approval_deferred"
down_revision: str = "consolidation_phase1_07_stalls_shell_api"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # checks
    op.create_table(
        "checks",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("check_type", sa.Text(), nullable=False),
        sa.Column("tool", sa.Text(), nullable=False),
        sa.Column("command", sa.Text(), nullable=True),
        sa.Column("working_directory", sa.Text(), nullable=True),
        sa.Column("config_path", sa.Text(), nullable=True),
        sa.Column("auto_fix", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("fail_on_warning", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True),
        sa.Column("is_critical", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ai_generation_prompt", sa.Text(), nullable=True),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_checks_type", "checks", ["check_type"], schema="project")
    op.create_index("idx_checks_tool", "checks", ["tool"], schema="project")
    op.create_index("idx_checks_enabled", "checks", ["enabled"], schema="project")

    # check_groups
    op.create_table(
        "check_groups",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("run_in_parallel", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("stop_on_failure", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_cg_enabled", "check_groups", ["enabled"], schema="project")

    # check_group_members
    op.create_table(
        "check_group_members",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("group_id", sa.Text(), sa.ForeignKey("project.check_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("check_id", sa.Text(), sa.ForeignKey("project.checks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "check_id", name="check_group_members_group_check_uniq"),
        schema="project",
    )
    op.create_index("idx_cgm_group", "check_group_members", ["group_id"], schema="project")
    op.create_index("idx_cgm_check", "check_group_members", ["check_id"], schema="project")

    # user_skills
    op.create_table(
        "user_skills",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True, server_default=sa.text("''")),
        sa.Column("category", sa.Text(), nullable=True, server_default=sa.text("'custom'")),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("icon", sa.Text(), nullable=True, server_default=sa.text("'puzzle'")),
        sa.Column("color", sa.Text(), nullable=True, server_default=sa.text("'gray'")),
        sa.Column("allowed_phases", sa.Text(), nullable=False, server_default=sa.text("'[\"setup\"]'")),
        sa.Column("parameters", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'user'")),
        sa.Column("version", sa.Text(), nullable=True, server_default=sa.text("'1.0.0'")),
        sa.Column("author", sa.Text(), nullable=True),
        sa.Column("checksum", sa.Text(), nullable=True),
        sa.Column("depends_on", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("usage_count", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("approval_status", sa.Text(), nullable=True),
        sa.Column("forked_from", sa.Text(), nullable=True),
        sa.Column("source_fix_id", sa.Text(), nullable=True),
        sa.Column("source_pattern_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
        schema="project",
    )
    op.create_index("idx_us_slug", "user_skills", ["slug"], schema="project")
    op.create_index("idx_us_category", "user_skills", ["category"], schema="project")
    op.create_index("idx_us_updated_at", "user_skills", ["updated_at"], schema="project")
    op.create_index("idx_us_source", "user_skills", ["source"], schema="project")

    # approval_gates (FK → task_runs CASCADE)
    op.create_table(
        "approval_gates",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("context_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("action", sa.Text(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ag_task_run_id", "approval_gates", ["task_run_id"], schema="project")
    op.create_index("idx_ag_status", "approval_gates", ["status"], schema="project")

    # deferred_questions (FK → task_runs CASCADE; GIN FTS via op.execute)
    op.create_table(
        "deferred_questions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("context_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("auto_decision_type", sa.Text(), nullable=False),
        sa.Column("auto_decision_detail", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("risk_level", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("git_checkpoint", sa.Text(), nullable=True),
        sa.Column("contingent_iterations", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("reviewer_comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_dq_task_run_id", "deferred_questions", ["task_run_id"], schema="project")
    op.create_index("idx_dq_status", "deferred_questions", ["status"], schema="project")
    op.execute(
        "CREATE INDEX idx_dq_fts ON project.deferred_questions "
        "USING GIN (to_tsvector('english', question || ' ' || COALESCE(context_json, '')))"
    )

    # settings
    op.create_table(
        "settings",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("key"),
        schema="project",
    )

    # configs
    op.create_table(
        "configs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_configs_name", "configs", ["name"], schema="project")

    # observations — folds memory-consolidation columns from later ALTERs
    op.create_table(
        "observations",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("observation_type", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False, server_default=sa.text("'project'")),
        sa.Column("topic_key", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("revision_count", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("duplicate_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("project_id", sa.Text(), nullable=True),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("task_run_id", sa.Text(), sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "superseded_by",
            sa.BigInteger(),
            sa.ForeignKey("project.observations.id", name="observations_superseded_by_fkey"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        # Memory consolidation columns (folded in from later ALTERs in source)
        sa.Column("importance", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("access_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("decay_rate", sa.Float(), nullable=False, server_default=sa.text("0.1")),
        sa.Column(
            "consolidated_from",
            postgresql.ARRAY(sa.BigInteger()),
            nullable=True,
        ),
        sa.Column("is_mental_model", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_obs_topic_key",
        "observations",
        ["topic_key"],
        unique=True,
        schema="project",
        postgresql_where=sa.text("topic_key IS NOT NULL AND NOT is_deleted"),
    )
    op.create_index("idx_obs_content_hash", "observations", ["content_hash"], schema="project")
    op.create_index(
        "idx_obs_project_type",
        "observations",
        ["project_id", "observation_type"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "idx_obs_scope",
        "observations",
        ["scope"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index("idx_obs_created_at", "observations", ["created_at"], schema="project")
    op.create_index(
        "idx_obs_task_run",
        "observations",
        ["task_run_id"],
        schema="project",
        postgresql_where=sa.text("task_run_id IS NOT NULL"),
    )
    op.execute(
        "CREATE INDEX idx_obs_fts ON project.observations "
        "USING GIN (to_tsvector('english', title || ' ' || content)) "
        "WHERE NOT is_deleted"
    )
    op.create_index(
        "idx_obs_valid_from",
        "observations",
        ["valid_from"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "idx_obs_valid_until",
        "observations",
        ["valid_until"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "idx_obs_superseded",
        "observations",
        ["superseded_by"],
        schema="project",
        postgresql_where=sa.text("superseded_by IS NOT NULL"),
    )
    op.create_index(
        "idx_obs_importance",
        "observations",
        ["importance"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "idx_obs_mental_model",
        "observations",
        ["is_mental_model"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted AND is_mental_model"),
    )
    op.create_index(
        "idx_obs_last_accessed",
        "observations",
        ["last_accessed_at"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )

    # memory_consolidation_log
    op.create_table(
        "memory_consolidation_log",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observations_scanned", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("groups_found", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("models_created", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("observations_merged", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("observations_decayed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("observations_archived", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )

    # observation_history
    op.create_table(
        "observation_history",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("observation_id", sa.BigInteger(), sa.ForeignKey("project.observations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_obs_history_obs_id", "observation_history", ["observation_id"], schema="project")
    op.create_index("idx_obs_history_valid", "observation_history", ["valid_from", "valid_until"], schema="project")


def downgrade() -> None:
    op.drop_table("observation_history", schema="project")
    op.drop_table("memory_consolidation_log", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_obs_fts")
    op.drop_table("observations", schema="project")
    op.drop_table("configs", schema="project")
    op.drop_table("settings", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_dq_fts")
    op.drop_table("deferred_questions", schema="project")
    op.drop_table("approval_gates", schema="project")
    op.drop_table("user_skills", schema="project")
    op.drop_table("check_group_members", schema="project")
    op.drop_table("check_groups", schema="project")
    op.drop_table("checks", schema="project")
