"""
Repository for project image database operations.

Extracts database query logic from project_images.py endpoints into reusable methods.
"""

from uuid import UUID

import structlog
from app.models.project_assets import ProjectImage, ProjectScreenshot
from app.repositories.base import BaseRepository
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ProjectImageCreate(BaseModel):
    """Schema for creating a project image."""

    project_id: UUID
    user_id: UUID
    name: str
    s3_key: str
    thumbnail_s3_key: str | None = None
    width: int
    height: int
    size_bytes: int
    source: str
    source_screenshot_id: UUID | None = None
    source_region: dict[str, int] | None = None
    metadata: dict | None = None


class ProjectImageRepository(BaseRepository[ProjectImage, ProjectImageCreate]):
    """
    Repository for project image database operations.

    Provides specialized query methods for project images including:
    - List images with pagination and filtering
    - Get image by ID with project validation
    - Batch operations for deleting multiple images
    """

    def __init__(self) -> None:
        super().__init__(ProjectImage)

    async def get_by_project(
        self,
        db: AsyncSession,
        image_id: UUID,
        project_id: UUID,
    ) -> ProjectImage | None:
        """
        Get an image by ID, ensuring it belongs to the specified project.

        Args:
            db: Async database session
            image_id: UUID of the image
            project_id: UUID of the project

        Returns:
            ProjectImage if found and belongs to project, None otherwise
        """
        query = select(ProjectImage).where(
            ProjectImage.id == image_id,
            ProjectImage.project_id == project_id,
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    async def list_by_project(
        self,
        db: AsyncSession,
        project_id: UUID,
        source: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[ProjectImage], int]:
        """
        List images for a project with optional filtering.

        Args:
            db: Async database session
            project_id: UUID of the project
            source: Optional filter by source type
            offset: Pagination offset
            limit: Maximum number of results

        Returns:
            Tuple of (list of images, total count)
        """
        # Build base query
        query = select(ProjectImage).where(ProjectImage.project_id == project_id)

        # Apply source filter if provided
        if source:
            query = query.where(ProjectImage.source == source)

        # Get total count
        count_query = select(func.count(ProjectImage.id)).where(
            ProjectImage.project_id == project_id
        )
        if source:
            count_query = count_query.where(ProjectImage.source == source)

        count_result = await db.execute(count_query)
        total = count_result.scalar_one()

        # Apply sorting and pagination
        query = (
            query.order_by(ProjectImage.created_at.desc()).offset(offset).limit(limit)
        )

        result = await db.execute(query)
        images = list(result.scalars().all())

        logger.debug(
            "list_by_project_completed",
            project_id=str(project_id),
            total=total,
            returned=len(images),
        )

        return images, total

    async def get_many_by_project(
        self,
        db: AsyncSession,
        image_ids: list[UUID],
        project_id: UUID,
    ) -> list[ProjectImage]:
        """
        Get multiple images by IDs, ensuring they belong to the project.

        Args:
            db: Async database session
            image_ids: List of image UUIDs
            project_id: UUID of the project

        Returns:
            List of ProjectImage objects found
        """
        query = select(ProjectImage).where(
            ProjectImage.id.in_(image_ids),
            ProjectImage.project_id == project_id,
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    async def delete_image(
        self,
        db: AsyncSession,
        image: ProjectImage,
    ) -> None:
        """
        Delete an image from the database.

        Note: This only deletes the database record. S3 cleanup should be done
        separately by the service layer.

        Args:
            db: Async database session
            image: ProjectImage to delete
        """
        await db.delete(image)
        await db.commit()

        logger.info("image_deleted_from_db", image_id=str(image.id))

    async def delete_many(
        self,
        db: AsyncSession,
        images: list[ProjectImage],
    ) -> int:
        """
        Delete multiple images from the database.

        Args:
            db: Async database session
            images: List of ProjectImage objects to delete

        Returns:
            Number of images deleted
        """
        for image in images:
            await db.delete(image)

        await db.commit()

        logger.info("images_batch_deleted_from_db", count=len(images))
        return len(images)


class ProjectScreenshotRepository(BaseRepository[ProjectScreenshot, BaseModel]):
    """
    Repository for project screenshot database operations.

    Provides specialized query methods for project screenshots including:
    - List screenshots with pagination and filtering
    - Get screenshot by ID with project validation
    - Batch operations for deleting multiple screenshots
    """

    def __init__(self) -> None:
        super().__init__(ProjectScreenshot)

    async def get_by_project(
        self,
        db: AsyncSession,
        screenshot_id: UUID,
        project_id: UUID,
    ) -> ProjectScreenshot | None:
        """
        Get a screenshot by ID, ensuring it belongs to the specified project.

        Args:
            db: Async database session
            screenshot_id: UUID of the screenshot
            project_id: UUID of the project

        Returns:
            ProjectScreenshot if found and belongs to project, None otherwise
        """
        query = select(ProjectScreenshot).where(
            ProjectScreenshot.id == screenshot_id,
            ProjectScreenshot.project_id == project_id,
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    async def list_by_project(
        self,
        db: AsyncSession,
        project_id: UUID,
        source: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[ProjectScreenshot], int]:
        """
        List screenshots for a project with optional filtering.

        Args:
            db: Async database session
            project_id: UUID of the project
            source: Optional filter by source type
            offset: Pagination offset
            limit: Maximum number of results

        Returns:
            Tuple of (list of screenshots, total count)
        """
        # Build base query
        query = select(ProjectScreenshot).where(
            ProjectScreenshot.project_id == project_id
        )

        # Apply source filter if provided
        if source:
            query = query.where(ProjectScreenshot.source == source)

        # Get total count
        count_query = select(func.count(ProjectScreenshot.id)).where(
            ProjectScreenshot.project_id == project_id
        )
        if source:
            count_query = count_query.where(ProjectScreenshot.source == source)

        count_result = await db.execute(count_query)
        total = count_result.scalar_one()

        # Apply sorting and pagination
        query = (
            query.order_by(ProjectScreenshot.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        result = await db.execute(query)
        screenshots = list(result.scalars().all())

        logger.debug(
            "list_screenshots_by_project_completed",
            project_id=str(project_id),
            total=total,
            returned=len(screenshots),
        )

        return screenshots, total

    async def get_many_by_project(
        self,
        db: AsyncSession,
        screenshot_ids: list[UUID],
        project_id: UUID,
    ) -> list[ProjectScreenshot]:
        """
        Get multiple screenshots by IDs, ensuring they belong to the project.

        Args:
            db: Async database session
            screenshot_ids: List of screenshot UUIDs
            project_id: UUID of the project

        Returns:
            List of ProjectScreenshot objects found
        """
        query = select(ProjectScreenshot).where(
            ProjectScreenshot.id.in_(screenshot_ids),
            ProjectScreenshot.project_id == project_id,
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    async def delete_screenshot(
        self,
        db: AsyncSession,
        screenshot: ProjectScreenshot,
    ) -> None:
        """
        Delete a screenshot from the database.

        Note: This only deletes the database record. S3 cleanup should be done
        separately by the service layer.

        Args:
            db: Async database session
            screenshot: ProjectScreenshot to delete
        """
        await db.delete(screenshot)
        await db.commit()

        logger.info("screenshot_deleted_from_db", screenshot_id=str(screenshot.id))

    async def delete_many(
        self,
        db: AsyncSession,
        screenshots: list[ProjectScreenshot],
    ) -> int:
        """
        Delete multiple screenshots from the database.

        Args:
            db: Async database session
            screenshots: List of ProjectScreenshot objects to delete

        Returns:
            Number of screenshots deleted
        """
        for screenshot in screenshots:
            await db.delete(screenshot)

        await db.commit()

        logger.info("screenshots_batch_deleted_from_db", count=len(screenshots))
        return len(screenshots)


# Singleton instances for convenience
project_image_repository = ProjectImageRepository()
project_screenshot_repository = ProjectScreenshotRepository()
