"""add_enum_check_constraints

Revision ID: b82857923798
Revises: c811d4fb1d00
Create Date: 2025-11-21 10:30:34.151418

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b82857923798"
down_revision: str | None = "c811d4fb1d00"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add CHECK constraints for all enum fields to ensure data integrity."""

    # Subscriptions table - tier and status
    op.create_check_constraint(
        "chk_subscription_tier", "subscriptions", "tier IN ('free', 'hobby', 'pro')"
    )
    op.create_check_constraint(
        "chk_subscription_status",
        "subscriptions",
        "status IN ('active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid')",
    )

    # Team members table - role
    op.create_check_constraint(
        "chk_team_member_role",
        "team_members",
        "role IN ('owner', 'admin', 'member', 'viewer')",
    )

    # Organization invitations table - role
    op.create_check_constraint(
        "chk_org_invitation_role",
        "organization_invitations",
        "role IN ('owner', 'admin', 'member', 'viewer')",
    )

    # Project access control - permission level
    op.create_check_constraint(
        "chk_project_access_permission",
        "project_access_control",
        "permission_level IN ('view', 'comment', 'edit', 'admin')",
    )

    # Automation sessions - status
    op.create_check_constraint(
        "chk_automation_session_status",
        "automation_sessions",
        "status IN ('active', 'completed', 'failed')",
    )

    # Automation logs - level (Python logging levels)
    op.create_check_constraint(
        "chk_automation_log_level",
        "automation_logs",
        "level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')",
    )

    # Automation input events - event_type
    op.create_check_constraint(
        "chk_input_event_type",
        "automation_input_events",
        "event_type IN ('mouse.clicked', 'mouse.moved', 'mouse.dragged', 'keyboard.text_typed')",
    )

    # Automation input events - mouse_button (nullable, so check only when not null)
    op.create_check_constraint(
        "chk_mouse_button",
        "automation_input_events",
        "mouse_button IS NULL OR mouse_button IN ('left', 'right', 'middle')",
    )

    # Analysis jobs - status
    op.create_check_constraint(
        "chk_analysis_job_status",
        "analysis_jobs",
        "status IN ('pending', 'running', 'completed', 'failed')",
    )

    # Region analysis jobs - status
    op.create_check_constraint(
        "chk_region_analysis_job_status",
        "region_analysis_jobs",
        "status IN ('pending', 'running', 'completed', 'failed')",
    )


def downgrade() -> None:
    """Remove CHECK constraints."""

    # Remove all check constraints in reverse order
    op.drop_constraint(
        "chk_region_analysis_job_status", "region_analysis_jobs", type_="check"
    )
    op.drop_constraint("chk_analysis_job_status", "analysis_jobs", type_="check")
    op.drop_constraint("chk_mouse_button", "automation_input_events", type_="check")
    op.drop_constraint("chk_input_event_type", "automation_input_events", type_="check")
    op.drop_constraint("chk_automation_log_level", "automation_logs", type_="check")
    op.drop_constraint(
        "chk_automation_session_status", "automation_sessions", type_="check"
    )
    op.drop_constraint(
        "chk_project_access_permission", "project_access_control", type_="check"
    )
    op.drop_constraint(
        "chk_org_invitation_role", "organization_invitations", type_="check"
    )
    op.drop_constraint("chk_team_member_role", "team_members", type_="check")
    op.drop_constraint("chk_subscription_status", "subscriptions", type_="check")
    op.drop_constraint("chk_subscription_tier", "subscriptions", type_="check")
