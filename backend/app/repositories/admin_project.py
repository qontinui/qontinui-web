"""
Repository for admin project management operations.

Provides optimized queries for viewing project data in the admin dashboard.
"""

import uuid
from typing import Any

import structlog
from app.models.project import Project
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

logger = structlog.get_logger(__name__)


class AdminProjectRepository:
    """
    Repository for admin project management operations.

    Provides specialized queries for:
    - Listing all projects with owner info
    - Project details with full configuration
    """

    async def list_all_projects(
        self,
        db: AsyncSession,
        skip: int = 0,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """
        List all projects with owner information for admin dashboard.

        Args:
            db: Async database session
            skip: Number of records to skip for pagination
            limit: Maximum number of records to return

        Returns:
            List of project dicts with owner info and state/transition counts
        """
        query = (
            select(Project)
            .options(joinedload(Project.owner))
            .order_by(Project.updated_at.desc())
            .offset(skip)
            .limit(limit)
        )

        result = await db.execute(query)
        projects = result.unique().scalars().all()

        projects_data = []
        for project in projects:
            config: dict[str, Any] = project.configuration or {}  # type: ignore[assignment]
            state_count = len(config.get("states", []))
            transition_count = sum(
                len(state.get("transitions", [])) for state in config.get("states", [])
            )

            projects_data.append(
                {
                    "id": str(project.id),
                    "name": str(project.name),
                    "description": project.description,
                    "owner_id": str(project.owner_id),
                    "owner_username": project.owner.username,
                    "owner_email": project.owner.email,
                    "created_at": (
                        project.created_at.isoformat() if project.created_at else None
                    ),
                    "updated_at": (
                        project.updated_at.isoformat() if project.updated_at else None
                    ),
                    "state_count": state_count,
                    "transition_count": transition_count,
                }
            )

        logger.debug(
            "list_all_projects_completed",
            project_count=len(projects_data),
            skip=skip,
            limit=limit,
        )

        return projects_data

    async def get_project_with_details(
        self,
        db: AsyncSession,
        project_id: uuid.UUID,
    ) -> dict[str, Any] | None:
        """
        Get detailed project information including full configuration.

        Args:
            db: Async database session
            project_id: UUID of the project to retrieve

        Returns:
            Project dict with full details, or None if not found
        """
        query = (
            select(Project)
            .options(joinedload(Project.owner))
            .where(Project.id == project_id)
        )

        result = await db.execute(query)
        project = result.unique().scalar_one_or_none()

        if not project:
            return None

        config: dict[str, Any] = project.configuration or {}  # type: ignore[assignment]
        states = config.get("states", [])

        # Extract image library from two sources
        image_library = []

        # Images from general image library
        for image_asset in config.get("images", []):
            if image_asset:
                image_library.append(
                    {
                        "source": "image_library",
                        "image": image_asset,
                    }
                )

        # Images from states
        for state in states:
            if "image" in state and state["image"]:
                image_library.append(
                    {
                        "source": "state",
                        "state_id": state.get("id"),
                        "state_name": state.get("name"),
                        "image": state["image"],
                    }
                )

        return {
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "owner_id": str(project.owner_id),
            "owner_username": project.owner.username,
            "owner_email": project.owner.email,
            "created_at": (
                project.created_at.isoformat() if project.created_at else None
            ),
            "updated_at": (
                project.updated_at.isoformat() if project.updated_at else None
            ),
            "configuration": config,
            "states": states,
            "state_count": len(states),
            "transition_count": sum(
                len(state.get("transitions", [])) for state in states
            ),
            "image_library": image_library,
        }


# Singleton instance
admin_project_repository = AdminProjectRepository()
