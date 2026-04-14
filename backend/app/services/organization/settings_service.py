"""
Organization settings service for CRUD operations.

Provides business logic for:
- Creating organizations
- Updating organization settings
- Deleting organizations
- Slug generation and validation
"""

import re
from uuid import UUID

import structlog
from app.middleware.error_handler import not_found_error
from app.repositories.organization import organization_repo
from app.schemas.collaboration import (OrganizationCreate,
                                       OrganizationResponse,
                                       OrganizationUpdate)
from app.services.organization.membership_service import membership_service
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


def generate_slug(name: str) -> str:
    """Generate URL-friendly slug from organization name."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug)
    slug = slug.strip("-")
    return slug[:63]  # Max length


class OrganizationSettingsService:
    """Service for organization settings and CRUD."""

    async def ensure_slug_unique(
        self,
        db: AsyncSession,
        slug: str,
        exclude_id: UUID | None = None,
    ) -> str:
        """Ensure slug is unique by appending number if necessary."""
        base_slug = slug
        counter = 1

        while await organization_repo.slug_exists(db, slug, exclude_id):
            slug = f"{base_slug}-{counter}"
            counter += 1

        return slug

    async def create_organization(
        self,
        db: AsyncSession,
        organization_in: OrganizationCreate,
        owner_id: UUID,
    ) -> OrganizationResponse:
        """Create a new organization."""
        logger.info(
            "create_organization_request",
            user_id=owner_id,
            name=organization_in.name,
        )

        # Generate unique slug
        slug = organization_in.slug or generate_slug(organization_in.name)
        slug = await self.ensure_slug_unique(db, slug)

        # Create organization with owner
        organization = await organization_repo.create(
            db=db,
            name=organization_in.name,
            slug=slug,
            owner_id=owner_id,
            description=organization_in.description,
        )

        logger.info("organization_created", org_id=organization.id, slug=slug)

        response = OrganizationResponse.model_validate(organization)
        response.member_count = 1

        return response

    async def get_organization(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
    ) -> OrganizationResponse:
        """Get organization details."""
        organization = await organization_repo.get_by_id(db, org_id, with_members=True)
        if not organization:
            raise not_found_error("Organization", "organization")

        # Verify membership
        await membership_service.verify_membership(db, org_id, user_id, "member")

        response = OrganizationResponse.model_validate(organization)
        response.member_count = len(organization.members)

        return response

    async def list_user_organizations(
        self,
        db: AsyncSession,
        user_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[OrganizationResponse]:
        """List all organizations the user is a member of."""
        logger.info("list_organizations_request", user_id=user_id)

        organizations = await organization_repo.list_by_user(db, user_id, skip, limit)

        responses = []
        for org in organizations:
            response = OrganizationResponse.model_validate(org)
            response.member_count = len(org.members)
            responses.append(response)

        logger.info("list_organizations_response", count=len(responses))
        return responses

    async def update_organization(
        self,
        db: AsyncSession,
        org_id: UUID,
        organization_update: OrganizationUpdate,
        user_id: UUID,
    ) -> OrganizationResponse:
        """Update organization (admin only)."""
        organization = await organization_repo.get_by_id(db, org_id)
        if not organization:
            raise not_found_error("Organization", "organization")

        # Verify caller is admin
        await membership_service.verify_membership(db, org_id, user_id, "admin")

        # Update fields
        update_data = organization_update.model_dump(exclude_unset=True)
        organization = await organization_repo.update(db, organization, update_data)

        logger.info("organization_updated", org_id=org_id)

        return OrganizationResponse.model_validate(organization)

    async def delete_organization(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
    ) -> None:
        """Delete organization (owner only)."""
        organization = await organization_repo.get_by_id(db, org_id)
        if not organization:
            raise not_found_error("Organization", "organization")

        # Only owner can delete
        if organization.owner_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the organization owner can delete it",
            )

        await organization_repo.delete(db, organization)
        logger.info("organization_deleted", org_id=org_id)


# Singleton instance
organization_settings_service = OrganizationSettingsService()
