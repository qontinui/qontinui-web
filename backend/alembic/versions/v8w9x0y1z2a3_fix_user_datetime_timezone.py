"""fix all datetime columns to use timezone

Revision ID: v8w9x0y1z2a3
Revises: u7v8w9x0y1z2
Create Date: 2026-03-19 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "v8w9x0y1z2a3"
down_revision = "u7v8w9x0y1z2"
branch_labels = None
depends_on = None

# Every (table, column) pair that is currently TIMESTAMP WITHOUT TIME ZONE
# but should be TIMESTAMP WITH TIME ZONE to match the Python models which
# use datetime.now(UTC) (timezone-aware) defaults.
COLUMNS = [
    ("activity_logs", "created_at"),
    ("admin_notification_settings", "created_at"),
    ("admin_notification_settings", "updated_at"),
    ("ai_prompt_templates", "created_at"),
    ("ai_prompt_templates", "updated_at"),
    ("analytics_events", "created_at"),
    ("analytics_events", "timestamp"),
    ("annotation_sets", "created_at"),
    ("annotation_sets", "updated_at"),
    ("audit_logs", "created_at"),
    ("automation_input_events", "created_at"),
    ("automation_input_events", "timestamp"),
    ("automation_videos", "created_at"),
    ("code_packages", "created_at"),
    ("code_packages", "updated_at"),
    ("conflict_logs", "detected_at"),
    ("conflict_logs", "resolved_at"),
    ("custom_functions", "created_at"),
    ("custom_functions", "updated_at"),
    ("device_sessions", "created_at"),
    ("device_sessions", "first_seen"),
    ("device_sessions", "last_seen"),
    ("device_sessions", "updated_at"),
    ("device_sessions", "verification_sent_at"),
    ("discovered_transitions", "converted_at"),
    ("discovered_transitions", "created_at"),
    ("edit_commands", "applied_at"),
    ("element_annotation_sets", "created_at"),
    ("element_annotation_sets", "updated_at"),
    ("extraction_annotations", "created_at"),
    ("extraction_annotations", "updated_at"),
    ("extraction_sessions", "completed_at"),
    ("extraction_sessions", "created_at"),
    ("extraction_sessions", "started_at"),
    ("notification_preferences", "created_at"),
    ("notification_preferences", "updated_at"),
    ("notifications", "created_at"),
    ("notifications", "read_at"),
    ("organization_invitations", "accepted_at"),
    ("organization_invitations", "created_at"),
    ("organization_invitations", "expires_at"),
    ("organizations", "created_at"),
    ("organizations", "updated_at"),
    ("package_categories", "created_at"),
    ("package_categories", "updated_at"),
    ("package_installations", "installed_at"),
    ("package_installations", "updated_at"),
    ("package_ratings", "created_at"),
    ("package_ratings", "updated_at"),
    ("package_versions", "created_at"),
    ("processing_logs", "timestamp"),
    ("project_access_control", "created_at"),
    ("project_access_control", "expires_at"),
    ("project_annotation_states", "updated_at"),
    ("project_comments", "created_at"),
    ("project_comments", "resolved_at"),
    ("project_comments", "updated_at"),
    ("project_locks", "acquired_at"),
    ("project_locks", "expires_at"),
    ("project_versions", "created_at"),
    ("projects", "created_at"),
    ("projects", "updated_at"),
    ("prompt_sequences", "created_at"),
    ("prompt_sequences", "updated_at"),
    ("recording_contexts", "timestamp"),
    ("recording_frames", "timestamp"),
    ("recording_frames", "url_expires_at"),
    ("recording_interactions", "timestamp"),
    ("recordings", "accepted_at"),
    ("recordings", "created_at"),
    ("recordings", "processing_completed_at"),
    ("recordings", "processing_started_at"),
    ("recordings", "recording_end_time"),
    ("recordings", "recording_start_time"),
    ("recordings", "reviewed_at"),
    ("recordings", "updated_at"),
    ("runner_devices", "created_at"),
    ("runner_devices", "last_seen_at"),
    ("runner_devices", "updated_at"),
    ("session_activities", "absolute_expiry_at"),
    ("session_activities", "created_at"),
    ("session_activities", "first_login_at"),
    ("session_activities", "last_activity_at"),
    ("session_activities", "updated_at"),
    ("state_machine_configs", "created_at"),
    ("state_machine_configs", "updated_at"),
    ("storage_usage", "created_at"),
    ("subscriptions", "canceled_at"),
    ("subscriptions", "created_at"),
    ("subscriptions", "current_period_end"),
    ("subscriptions", "current_period_start"),
    ("subscriptions", "updated_at"),
    ("team_members", "joined_at"),
    ("team_members", "last_active_at"),
    ("training_dataset_annotations", "created_at"),
    ("training_dataset_annotations", "reviewed_at"),
    ("training_dataset_annotations", "updated_at"),
    ("training_dataset_export_jobs", "completed_at"),
    ("training_dataset_export_jobs", "created_at"),
    ("training_dataset_images", "created_at"),
    ("training_dataset_images", "reviewed_at"),
    ("training_dataset_images", "timestamp"),
    ("training_datasets", "created_at"),
    ("training_datasets", "updated_at"),
    ("training_jobs", "completed_at"),
    ("training_jobs", "created_at"),
    ("training_jobs", "started_at"),
    ("training_jobs", "updated_at"),
    ("usage_metrics", "timestamp"),
    ("variable_history", "changed_at"),
    ("workflow_variables", "created_at"),
    ("workflow_variables", "updated_at"),
]


def upgrade() -> None:
    # Convert all naive timestamps to timezone-aware (UTC).
    # PostgreSQL: ALTER COLUMN ... TYPE TIMESTAMPTZ USING col AT TIME ZONE 'UTC'
    # treats existing naive values as UTC and stores them as timestamptz.
    for table, column in COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(timezone=True),
            existing_type=sa.DateTime(),
            postgresql_using=f"\"{column}\" AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    for table, column in COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(),
            existing_type=sa.DateTime(timezone=True),
        )
