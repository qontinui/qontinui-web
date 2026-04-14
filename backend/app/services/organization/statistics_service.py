"""
Statistics service for organization analytics.

Provides business logic for:
- Organization member counts
- Project counts
- Active user tracking
- Workflow statistics
"""

from uuid import UUID

import structlog
from app.repositories.organization import project_stats_repo, team_member_repo
from app.schemas.collaboration import OrganizationStatistics
from app.services.organization.membership_service import membership_service
from app.services.permission_service import permission_service
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class StatisticsService:
    """Service for organization statistics."""

    async def get_organization_statistics(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
    ) -> OrganizationStatistics:
        """
        Get statistics for an organization.

        Returns member count, project count, active users today, and total workflows.
        User must be a member of the organization to view statistics.
        """
        logger.info(
            "get_org_statistics_request",
            user_id=user_id,
            organization_id=org_id,
        )

        # Verify user is a member
        await membership_service.verify_membership(db, org_id, user_id, "member")

        # Gather statistics in parallel-ish (sequential for simplicity)
        member_count = await team_member_repo.count_members(db, org_id)
        project_count = await project_stats_repo.count_by_organization(db, org_id)
        active_users_today = await team_member_repo.count_active_today(db, org_id)

        # Total workflows is approximated by project count
        # A more accurate count would require parsing project configuration JSON
        total_workflows = project_count

        logger.info(
            "get_org_statistics_response",
            organization_id=org_id,
            member_count=member_count,
            project_count=project_count,
            active_users_today=active_users_today,
            total_workflows=total_workflows,
        )

        return OrganizationStatistics(
            member_count=member_count,
            project_count=project_count,
            active_users_today=active_users_today,
            total_workflows=total_workflows,
        )

    async def list_organization_projects(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list:
        """
        List all projects in an organization.

        User must be a member of the organization to view its projects.
        Returns all projects where organization_id matches that the user can access.
        """
        from app.core.error_codes import ErrorCode
        from app.middleware.error_handler import forbidden_error

        logger.info(
            "list_org_projects_request",
            user_id=user_id,
            organization_id=org_id,
        )

        # Verify user is a member of the organization
        membership = await permission_service.check_organization_membership(
            db, user_id, org_id, "member"
        )
        if not membership:
            raise forbidden_error(
                "You are not a member of this organization",
                ErrorCode.INSUFFICIENT_PERMISSIONS,
            )

        # Get all accessible projects for this user
        all_projects = await permission_service.get_user_accessible_projects(
            db, user_id
        )

        # Filter to only projects in this organization
        org_projects = [p for p in all_projects if p.organization_id == org_id]

        # Apply pagination
        paginated_projects = org_projects[skip : skip + limit]

        logger.info(
            "list_org_projects_response",
            organization_id=org_id,
            project_count=len(paginated_projects),
            total_org_projects=len(org_projects),
        )

        return paginated_projects


# Singleton instance
statistics_service = StatisticsService()
