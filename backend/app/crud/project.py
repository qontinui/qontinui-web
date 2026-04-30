from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.project_directory import ProjectDirectoryManager

logger = structlog.get_logger(__name__)


async def get_project(db: AsyncSession, project_id: UUID) -> Project | None:
    result = await db.execute(select(Project).filter(Project.id == project_id))
    return result.scalar_one_or_none()


async def get_projects_by_owner(
    db: AsyncSession, owner_id: UUID, skip: int = 0, limit: int = 100
) -> list[Project]:
    result = await db.execute(
        select(Project).filter(Project.owner_id == owner_id).offset(skip).limit(limit)
    )
    return list(result.scalars().all())


async def create_project(
    db: AsyncSession,
    project: ProjectCreate,
    owner_id: UUID,
    organization_id: UUID | None = None,
) -> Project:
    db_project = Project(
        name=project.name,
        description=project.description,
        configuration=project.configuration,
        owner_id=owner_id,
        organization_id=organization_id,
    )
    db.add(db_project)
    await db.commit()
    await db.refresh(db_project)

    # Create project directory structure
    try:
        directory_manager = ProjectDirectoryManager()
        directory_manager.create_project_directory(
            project_id=db_project.id,  # type: ignore[arg-type]
            project_name=project.name,
            description=project.description or "",
        )
        logger.info(
            "project_directory_created",
            project_id=db_project.id,
            project_name=project.name,
        )
    except FileExistsError:
        # Directory already exists (shouldn't happen for new projects, but handle gracefully)
        logger.warning(
            "project_directory_already_exists",
            project_id=db_project.id,
        )
    except Exception as e:
        # Log error but don't fail project creation
        # Directory can be created later when first file is uploaded
        logger.error(
            "project_directory_creation_failed",
            project_id=db_project.id,
            error=str(e),
        )

    return db_project


class VersionConflictError(Exception):
    """Raised when expected version doesn't match current version."""

    def __init__(self, expected: int, current: int):
        self.expected = expected
        self.current = current
        super().__init__(f"Version conflict: expected {expected}, got {current}")


async def update_project(
    db: AsyncSession,
    project: Project,
    project_update: ProjectUpdate,
    expected_version: int | None = None,
) -> Project:
    """
    Update a project.

    Args:
        db: Database session
        project: Project to update
        project_update: Update data
        expected_version: If provided, update only succeeds if current version matches.
                         Raises VersionConflictError on mismatch.

    Returns:
        Updated project

    Raises:
        VersionConflictError: If expected_version doesn't match current version
    """
    # Check version for conditional update
    if expected_version is not None:
        if project.version != expected_version:
            raise VersionConflictError(expected_version, project.version)  # type: ignore[arg-type]

    update_data = project_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(project, field, value)

    # Increment version on every update
    project.version += 1  # type: ignore[assignment]

    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project_id: UUID) -> bool:
    project = await get_project(db, project_id)
    if project:
        # Delete project from database
        await db.delete(project)
        await db.commit()

        # Delete project directory
        try:
            directory_manager = ProjectDirectoryManager()
            directory_manager.delete_project_directory(project_id)
            logger.info(
                "project_directory_deleted_with_project",
                project_id=project_id,
            )
        except Exception as e:
            # Log error but don't fail project deletion
            logger.error(
                "project_directory_deletion_failed",
                project_id=project_id,
                error=str(e),
            )

        return True
    return False
