"""
Sharing service for project access control and collaboration.

Provides functionality for:
- Sharing projects with users and organizations
- Managing collaborator permissions
- Email notifications for sharing
"""

from typing import Any, cast
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import (
    Organization,
    OrganizationInvitation,
    PermissionLevel,
)
from app.repositories.collaboration.access_repository import access_repository
from app.schemas.collaboration import CollaboratorResponse
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService
from app.services.permission_service import permission_service

logger = structlog.get_logger(__name__)


class SharingService:
    """Service for project sharing and access control operations."""

    def __init__(self):
        """Initialize sharing service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()
        self.permission_service = permission_service

    async def check_user_has_access(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        required_permission: str = "view",
    ) -> bool:
        """
        Check if user has required access to a project.

        Delegates to PermissionService for consistency.

        Args:
            db: Database session
            user_id: User ID to check
            project_id: Project ID
            required_permission: Required permission level (view, comment, edit, admin)

        Returns:
            True if user has access, False otherwise
        """
        try:
            permission_map = {
                "view": PermissionLevel.VIEW,
                "comment": PermissionLevel.COMMENT,
                "edit": PermissionLevel.EDIT,
                "admin": PermissionLevel.ADMIN,
            }

            required_level = permission_map.get(required_permission.lower())
            if not required_level:
                logger.warning(
                    "invalid_permission_level",
                    required_permission=required_permission,
                )
                return False

            return await self.permission_service.can_user_access_project(
                db, user_id, project_id, required_level
            )

        except Exception as e:
            logger.error(
                "access_check_failed",
                error=str(e),
                user_id=user_id,
                project_id=project_id,
            )
            return False

    async def get_user_project_permission(
        self, db: AsyncSession, user_id: UUID, project_id: UUID
    ) -> str | None:
        """
        Get user's permission level for a project.

        Args:
            db: Database session
            user_id: User ID
            project_id: Project ID

        Returns:
            Permission level string or None if no access
        """
        try:
            level = await self.permission_service.get_user_permission_level(
                db, user_id, project_id
            )

            if level is None:
                return None

            return level.value

        except Exception as e:
            logger.error(
                "get_permission_level_failed",
                error=str(e),
                user_id=user_id,
                project_id=project_id,
            )
            return None

    async def get_project_collaborators(
        self,
        db: AsyncSession,
        project_id: UUID,
        offset: int = 0,
        limit: int = 100,
    ) -> list[CollaboratorResponse]:
        """
        Get all collaborators for a project.

        Args:
            db: Database session
            project_id: Project ID
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            List of collaborator responses with user/org info
        """
        accesses = await access_repository.get_project_collaborators(
            db, project_id, offset, limit
        )

        responses = []
        for access in accesses:
            response = CollaboratorResponse.model_validate(access)
            response.is_expired = access.is_expired

            if access.user:
                response.username = cast(str, access.user.username)
                response.email = cast(str, access.user.email)
                response.full_name = access.user.full_name
                response.avatar_url = access.user.avatar_url
            elif access.organization:
                response.organization_name = access.organization.name

            responses.append(response)

        return responses

    async def share_project(
        self,
        db: AsyncSession,
        project_id: UUID,
        created_by: UUID,
        permission_level: str,
        user_id: UUID | None = None,
        organization_id: UUID | None = None,
        expires_at: Any | None = None,
    ) -> CollaboratorResponse | None:
        """
        Share a project with a user or organization.

        Args:
            db: Database session
            project_id: Project ID
            created_by: User ID creating the share
            permission_level: Permission level to grant
            user_id: User ID to share with (mutually exclusive with organization_id)
            organization_id: Organization ID to share with
            expires_at: Optional expiration date

        Returns:
            CollaboratorResponse if shared, None if access already exists
        """
        # Check for existing access
        if user_id:
            existing = await access_repository.get_user_access(db, project_id, user_id)
        else:
            existing = await access_repository.get_organization_access(
                db,
                project_id,
                organization_id,  # type: ignore
            )

        if existing:
            return None

        access = await access_repository.create_access_control(
            db,
            project_id=project_id,
            permission_level=permission_level,
            created_by=created_by,
            user_id=user_id,
            organization_id=organization_id,
            expires_at=expires_at,
        )

        await db.commit()
        await db.refresh(access)

        response = CollaboratorResponse.model_validate(access)
        response.is_expired = access.is_expired

        return response

    async def update_collaborator(
        self,
        db: AsyncSession,
        access_id: UUID,
        project_id: UUID,
        update_data: dict[str, Any],
    ) -> CollaboratorResponse | None:
        """
        Update collaborator permissions.

        Args:
            db: Database session
            access_id: Access control ID
            project_id: Project ID
            update_data: Fields to update

        Returns:
            Updated collaborator response or None if not found
        """
        access = await access_repository.get_access_control_in_project(
            db, access_id, project_id
        )

        if not access:
            return None

        for field, value in update_data.items():
            setattr(access, field, value)

        await db.commit()
        await db.refresh(access)

        logger.info(
            "collaborator_updated", project_id=project_id, collaborator_id=access_id
        )

        response = CollaboratorResponse.model_validate(access)
        response.is_expired = access.is_expired

        return response

    async def revoke_access(
        self,
        db: AsyncSession,
        access_id: UUID,
        project_id: UUID,
    ) -> bool:
        """
        Revoke collaborator access.

        Args:
            db: Database session
            access_id: Access control ID
            project_id: Project ID

        Returns:
            True if revoked, False if not found
        """
        access = await access_repository.get_access_control_in_project(
            db, access_id, project_id
        )

        if not access:
            return False

        await access_repository.delete_access_control(db, access)
        await db.commit()

        logger.info(
            "collaborator_access_revoked",
            project_id=project_id,
            collaborator_id=access_id,
        )

        return True

    # ========================================================================
    # Email Notifications
    # ========================================================================

    async def send_invitation_email(
        self, invitation: OrganizationInvitation, organization: Organization
    ) -> bool:
        """
        Send organization invitation email.

        Args:
            invitation: Invitation object
            organization: Organization object

        Returns:
            True if sent successfully
        """
        try:
            from app.core.config import settings

            invitation_url = (
                f"{settings.FRONTEND_URL}/invitations/accept?token={invitation.token}"
            )

            html_body = self.email_templates.render_template(
                "organization_invitation",
                {
                    "organization_name": organization.name,
                    "organization_description": organization.description or "",
                    "role": invitation.role,
                    "invitation_url": invitation_url,
                    "expires_at": invitation.expires_at.strftime("%B %d, %Y"),
                },
            )

            email_value: str = invitation.email  # type: ignore[assignment]
            success = await self.email_transport.send_email(
                to_email=email_value,
                subject=f"You've been invited to join {organization.name} on Qontinui",
                text_body=f"You've been invited to join {organization.name}. Visit {invitation_url} to accept.",
                html_body=html_body,
            )

            if success:
                logger.info(
                    "invitation_email_sent",
                    email=invitation.email,
                    organization_id=organization.id,
                )
            else:
                logger.error(
                    "invitation_email_failed",
                    email=invitation.email,
                    organization_id=organization.id,
                )

            return success

        except Exception as e:
            logger.error("invitation_email_error", error=str(e))
            return False

    async def send_project_share_email(
        self,
        to_email: str,
        to_name: str,
        project_name: str,
        shared_by_name: str,
        permission_level: str,
    ) -> bool:
        """
        Send project sharing notification email.

        Args:
            to_email: Recipient email
            to_name: Recipient name
            project_name: Project name
            shared_by_name: Name of user sharing
            permission_level: Permission level granted

        Returns:
            True if sent successfully
        """
        try:
            from app.core.config import settings

            project_url = f"{settings.FRONTEND_URL}/projects"

            html_body = self.email_templates.render_template(
                "project_shared",
                {
                    "recipient_name": to_name,
                    "project_name": project_name,
                    "shared_by": shared_by_name,
                    "permission": permission_level,
                    "project_url": project_url,
                },
            )

            success = await self.email_transport.send_email(
                to_email=to_email,
                subject=f"{shared_by_name} shared '{project_name}' with you",
                text_body=f"{shared_by_name} has shared the project '{project_name}' with you. You have {permission_level} access.",
                html_body=html_body,
            )

            if success:
                logger.info(
                    "project_share_email_sent", email=to_email, project=project_name
                )
            else:
                logger.error("project_share_email_failed", email=to_email)

            return success

        except Exception as e:
            logger.error("project_share_email_error", error=str(e))
            return False


# Global instance
sharing_service = SharingService()
