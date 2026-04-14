"""
CRUD operations for code package management.

Provides pure database operations for packages, versions, and categories.
Business logic for search, installation, and rating is in dedicated services:
- app.services.package_search_service
- app.services.package_installation_service
- app.services.package_rating_service
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from app.models.code_package import (
    CodePackage,
    PackageCategory,
    PackageVersion,
    SecurityScanStatus,
)
from app.schemas.code_package import PackageCreate, PackageUpdate, VersionCreate
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


# ===== Category Operations =====


async def get_categories(db: AsyncSession) -> list[PackageCategory]:
    """Get all package categories."""
    result = await db.execute(select(PackageCategory).order_by(PackageCategory.name))
    return list(result.scalars().all())


async def get_category_by_id(
    db: AsyncSession, category_id: int
) -> PackageCategory | None:
    """Get category by ID."""
    result = await db.execute(
        select(PackageCategory).where(PackageCategory.id == category_id)
    )
    return result.scalar_one_or_none()


# ===== Package Operations =====


async def create_package(
    db: AsyncSession, author_id: UUID, package_data: PackageCreate
) -> CodePackage:
    """
    Create a new code package.

    Args:
        db: Database session
        author_id: UUID of the package author
        package_data: Package creation data

    Returns:
        Created package instance
    """
    # Generate slug from name (lowercase, replace spaces with hyphens)
    slug = package_data.name.lower().replace(" ", "-")

    package = CodePackage(
        name=package_data.name,
        slug=slug,
        description=package_data.description,
        long_description=package_data.long_description,
        author_id=author_id,
        category_id=package_data.category_id,
        license=package_data.license,
        tags=package_data.tags or [],
    )

    db.add(package)
    await db.commit()
    await db.refresh(package)

    logger.info("package_created", package_id=package.id, author_id=str(author_id))
    return package


async def get_package_by_id(db: AsyncSession, package_id: int) -> CodePackage | None:
    """Get package by ID with relationships loaded."""
    result = await db.execute(
        select(CodePackage)
        .where(CodePackage.id == package_id)
        .options(
            selectinload(CodePackage.author),
            selectinload(CodePackage.category),
            selectinload(CodePackage.versions),
        )
    )
    return result.scalar_one_or_none()


async def get_package_by_slug(db: AsyncSession, slug: str) -> CodePackage | None:
    """Get package by slug."""
    result = await db.execute(
        select(CodePackage)
        .where(CodePackage.slug == slug)
        .options(
            selectinload(CodePackage.author),
            selectinload(CodePackage.category),
            selectinload(CodePackage.versions),
        )
    )
    return result.scalar_one_or_none()


async def update_package(
    db: AsyncSession, package: CodePackage, update_data: PackageUpdate
) -> CodePackage:
    """
    Update package metadata.

    Args:
        db: Database session
        package: Package instance to update
        update_data: Update data

    Returns:
        Updated package instance
    """
    update_dict = update_data.model_dump(exclude_unset=True)

    for field, value in update_dict.items():
        setattr(package, field, value)

    package.updated_at = datetime.now(UTC)  # type: ignore[assignment]
    await db.commit()
    await db.refresh(package)

    logger.info("package_updated", package_id=package.id)
    return package


async def delete_package(db: AsyncSession, package: CodePackage) -> bool:
    """
    Delete a package.

    Args:
        db: Database session
        package: Package to delete

    Returns:
        True if deleted successfully
    """
    package_id = package.id
    await db.delete(package)
    await db.commit()

    logger.info("package_deleted", package_id=package_id)
    return True


async def get_user_packages(
    db: AsyncSession, user_id: UUID, skip: int = 0, limit: int = 100
) -> list[CodePackage]:
    """Get all packages created by a user."""
    result = await db.execute(
        select(CodePackage)
        .where(CodePackage.author_id == user_id)
        .options(selectinload(CodePackage.category))
        .order_by(desc(CodePackage.created_at))
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


# ===== Version Operations =====


async def create_version(
    db: AsyncSession, package_id: int, version_data: VersionCreate
) -> PackageVersion:
    """
    Create a new version of a package.

    Args:
        db: Database session
        package_id: Package ID
        version_data: Version creation data

    Returns:
        Created version instance

    Raises:
        ValueError: If version already exists
    """
    # Check if version already exists
    existing = await db.execute(
        select(PackageVersion).where(
            and_(
                PackageVersion.package_id == package_id,
                PackageVersion.version == version_data.version,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"Version {version_data.version} already exists")

    version = PackageVersion(
        package_id=package_id,
        version=version_data.version,
        code_content=version_data.code_content,
        function_name=version_data.function_name,
        changelog=version_data.changelog,
        dependencies=version_data.dependencies or [],
        min_python_version=version_data.min_python_version,
        security_scan_status=SecurityScanStatus.PENDING.value,
    )

    db.add(version)
    await db.commit()
    await db.refresh(version)

    logger.info(
        "version_created",
        package_id=package_id,
        version_id=version.id,
        version=version.version,
    )
    return version


# Alias for backward compatibility
publish_version = create_version


async def get_package_versions(
    db: AsyncSession, package_id: int
) -> list[PackageVersion]:
    """Get all versions of a package, ordered by creation date (newest first)."""
    result = await db.execute(
        select(PackageVersion)
        .where(PackageVersion.package_id == package_id)
        .order_by(desc(PackageVersion.created_at))
    )
    return list(result.scalars().all())


async def get_latest_version(
    db: AsyncSession, package_id: int
) -> PackageVersion | None:
    """Get the latest version of a package."""
    result = await db.execute(
        select(PackageVersion)
        .where(PackageVersion.package_id == package_id)
        .order_by(desc(PackageVersion.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_version_by_id(db: AsyncSession, version_id: int) -> PackageVersion | None:
    """Get version by ID."""
    result = await db.execute(
        select(PackageVersion).where(PackageVersion.id == version_id)
    )
    return result.scalar_one_or_none()


async def update_version_security_scan(
    db: AsyncSession,
    version: PackageVersion,
    status: str,
    scan_results: dict[str, Any] | None = None,
) -> PackageVersion:
    """
    Update security scan status and results for a version.

    Args:
        db: Database session
        version: Version instance
        status: Security scan status
        scan_results: Scan results dict

    Returns:
        Updated version instance
    """
    version.security_scan_status = status  # type: ignore[assignment]
    version.security_scan_result = scan_results  # type: ignore[assignment]

    await db.commit()
    await db.refresh(version)

    logger.info(
        "version_security_scan_updated",
        version_id=version.id,
        status=status,
    )
    return version
