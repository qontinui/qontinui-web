"""
CRUD operations for code package management.

Provides database operations for creating, reading, updating, and deleting
code packages, versions, installations, and ratings.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from app.models.code_package import (
    CodePackage,
    PackageCategory,
    PackageInstallation,
    PackageRating,
    PackageVersion,
    SecurityScanStatus,
)
from app.schemas.code_package import PackageCreate, PackageUpdate, VersionCreate
from sqlalchemy import and_, desc, func, or_, select
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

    logger.info("package_created", package_id=package.id, author_id=author_id)
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

    package.updated_at = datetime.utcnow()
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


async def publish_version(
    db: AsyncSession, package_id: int, version_data: VersionCreate
) -> PackageVersion:
    """
    Publish a new version of a package.

    Args:
        db: Database session
        package_id: Package ID
        version_data: Version creation data

    Returns:
        Created version instance
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
        "version_published",
        package_id=package_id,
        version_id=version.id,
        version=version.version,
    )
    return version


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
    version.security_scan_status = status
    version.security_scan_result = scan_results
    version.security_scan_at = datetime.utcnow()

    await db.commit()
    await db.refresh(version)

    logger.info(
        "version_security_scan_updated",
        version_id=version.id,
        status=status,
    )
    return version


# ===== Search Operations =====


async def search_packages(
    db: AsyncSession,
    query: str | None = None,
    category: int | None = None,
    tags: list[str] | None = None,
    verified_only: bool = False,
    min_rating: float | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[CodePackage], int]:
    """
    Search packages with filters and pagination.

    Args:
        db: Database session
        query: Text search query (searches name, description)
        category: Category ID filter
        tags: List of tags to filter by
        verified_only: Only return verified packages
        min_rating: Minimum average rating
        limit: Maximum number of results
        offset: Pagination offset

    Returns:
        Tuple of (packages, total_count)
    """
    # Build filter conditions
    conditions = []

    if query:
        search_term = f"%{query.lower()}%"
        conditions.append(
            or_(
                CodePackage.name.ilike(search_term),
                CodePackage.description.ilike(search_term),
                CodePackage.slug.ilike(search_term),
            )
        )

    if category:
        conditions.append(CodePackage.category_id == category)

    if tags:
        # Search for packages that have any of the specified tags
        for tag in tags:
            conditions.append(CodePackage.tags.contains([tag.lower()]))

    if verified_only:
        conditions.append(CodePackage.is_verified == True)

    if min_rating is not None:
        conditions.append(CodePackage.avg_rating >= min_rating)

    # Build base query
    base_query = select(CodePackage).options(selectinload(CodePackage.category))

    if conditions:
        base_query = base_query.where(and_(*conditions))

    # Get total count
    count_query = select(func.count()).select_from(CodePackage)
    if conditions:
        count_query = count_query.where(and_(*conditions))

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated results
    query_with_order = (
        base_query.order_by(desc(CodePackage.total_downloads))
        .offset(offset)
        .limit(limit)
    )

    result = await db.execute(query_with_order)
    packages = list(result.scalars().all())

    return packages, total


async def get_popular_packages(db: AsyncSession, limit: int = 20) -> list[CodePackage]:
    """
    Get most popular packages by download count.

    Args:
        db: Database session
        limit: Maximum number of packages to return

    Returns:
        List of popular packages
    """
    result = await db.execute(
        select(CodePackage)
        .options(selectinload(CodePackage.category))
        .order_by(desc(CodePackage.total_downloads))
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_trending_packages(
    db: AsyncSession, days: int = 7, limit: int = 20
) -> list[CodePackage]:
    """
    Get trending packages (high ratings + recent activity).

    Args:
        db: Database session
        days: Number of days to consider for trending
        limit: Maximum number of packages to return

    Returns:
        List of trending packages
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)

    result = await db.execute(
        select(CodePackage)
        .options(selectinload(CodePackage.category))
        .where(CodePackage.created_at >= cutoff_date)
        .order_by(
            desc(CodePackage.avg_rating),
            desc(CodePackage.total_downloads),
        )
        .limit(limit)
    )
    return list(result.scalars().all())


# ===== Installation Operations =====


async def install_package(
    db: AsyncSession, project_id: int, package_id: int, version_id: int, user_id: UUID
) -> PackageInstallation:
    """
    Install a package to a project.

    Args:
        db: Database session
        project_id: Project ID
        package_id: Package ID
        version_id: Version ID
        user_id: User ID performing installation

    Returns:
        Installation instance
    """
    # Check if already installed
    existing = await db.execute(
        select(PackageInstallation).where(
            and_(
                PackageInstallation.project_id == project_id,
                PackageInstallation.package_id == package_id,
            )
        )
    )
    existing_installation = existing.scalar_one_or_none()

    if existing_installation:
        # Update to new version
        existing_installation.version_id = version_id
        existing_installation.updated_at = datetime.utcnow()
        existing_installation.status = "active"
        await db.commit()
        await db.refresh(existing_installation)

        logger.info(
            "package_updated",
            installation_id=existing_installation.id,
            project_id=project_id,
            package_id=package_id,
            version_id=version_id,
        )
        return existing_installation

    # Create new installation
    installation = PackageInstallation(
        project_id=project_id,
        package_id=package_id,
        version_id=version_id,
        user_id=user_id,
        status="active",
    )

    db.add(installation)

    # Increment package total_downloads and total_installs
    package_result = await db.execute(
        select(CodePackage).where(CodePackage.id == package_id)
    )
    package = package_result.scalar_one_or_none()
    if package:
        package.total_downloads += 1
        package.total_installs += 1

    # Increment version download_count
    version_result = await db.execute(
        select(PackageVersion).where(PackageVersion.id == version_id)
    )
    version = version_result.scalar_one_or_none()
    if version:
        version.download_count += 1

    await db.commit()
    await db.refresh(installation)

    logger.info(
        "package_installed",
        installation_id=installation.id,
        project_id=project_id,
        package_id=package_id,
        version_id=version_id,
    )
    return installation


async def uninstall_package(db: AsyncSession, project_id: int, package_id: int) -> bool:
    """
    Uninstall a package from a project.

    Args:
        db: Database session
        project_id: Project ID
        package_id: Package ID

    Returns:
        True if uninstalled successfully
    """
    result = await db.execute(
        select(PackageInstallation).where(
            and_(
                PackageInstallation.project_id == project_id,
                PackageInstallation.package_id == package_id,
            )
        )
    )
    installation = result.scalar_one_or_none()

    if not installation:
        return False

    await db.delete(installation)

    # Decrement package total_installs
    package_result = await db.execute(
        select(CodePackage).where(CodePackage.id == package_id)
    )
    package = package_result.scalar_one_or_none()
    if package and package.total_installs > 0:
        package.total_installs -= 1

    await db.commit()

    logger.info(
        "package_uninstalled",
        project_id=project_id,
        package_id=package_id,
    )
    return True


async def get_project_packages(
    db: AsyncSession, project_id: int
) -> list[PackageInstallation]:
    """Get all packages installed in a project."""
    result = await db.execute(
        select(PackageInstallation)
        .where(PackageInstallation.project_id == project_id)
        .options(
            selectinload(PackageInstallation.package),
            selectinload(PackageInstallation.version),
        )
        .order_by(desc(PackageInstallation.installed_at))
    )
    return list(result.scalars().all())


# ===== Rating Operations =====


async def rate_package(
    db: AsyncSession, user_id: UUID, package_id: int, rating: int, review: str | None
) -> PackageRating:
    """
    Rate a package (create or update rating).

    Args:
        db: Database session
        user_id: User ID
        package_id: Package ID
        rating: Rating value (1-5)
        review: Optional review text

    Returns:
        Rating instance
    """
    # Check if user already rated this package
    existing = await db.execute(
        select(PackageRating).where(
            and_(
                PackageRating.user_id == user_id,
                PackageRating.package_id == package_id,
            )
        )
    )
    existing_rating = existing.scalar_one_or_none()

    if existing_rating:
        # Update existing rating
        existing_rating.rating = rating
        existing_rating.review_text = review
        existing_rating.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing_rating)

        # Recalculate average rating
        await _update_package_average_rating(db, package_id)

        logger.info(
            "rating_updated", rating_id=existing_rating.id, package_id=package_id
        )
        return existing_rating

    # Create new rating
    new_rating = PackageRating(
        user_id=user_id,
        package_id=package_id,
        rating=rating,
        review_text=review,
    )

    db.add(new_rating)
    await db.commit()
    await db.refresh(new_rating)

    # Recalculate average rating
    await _update_package_average_rating(db, package_id)

    logger.info("rating_created", rating_id=new_rating.id, package_id=package_id)
    return new_rating


async def get_package_ratings(
    db: AsyncSession, package_id: int, limit: int = 50, offset: int = 0
) -> tuple[list[PackageRating], int]:
    """
    Get ratings for a package with pagination.

    Args:
        db: Database session
        package_id: Package ID
        limit: Maximum number of ratings
        offset: Pagination offset

    Returns:
        Tuple of (ratings, total_count)
    """
    # Get total count
    count_result = await db.execute(
        select(func.count())
        .select_from(PackageRating)
        .where(PackageRating.package_id == package_id)
    )
    total = count_result.scalar() or 0

    # Get paginated ratings
    result = await db.execute(
        select(PackageRating)
        .where(PackageRating.package_id == package_id)
        .options(selectinload(PackageRating.user))
        .order_by(desc(PackageRating.created_at))
        .offset(offset)
        .limit(limit)
    )
    ratings = list(result.scalars().all())

    return ratings, total


async def _update_package_average_rating(db: AsyncSession, package_id: int) -> None:
    """
    Internal helper to recalculate and update package average rating.

    Args:
        db: Database session
        package_id: Package ID
    """
    result = await db.execute(
        select(func.avg(PackageRating.rating), func.count(PackageRating.id)).where(
            PackageRating.package_id == package_id
        )
    )
    avg_rating, count = result.one()

    package_result = await db.execute(
        select(CodePackage).where(CodePackage.id == package_id)
    )
    package = package_result.scalar_one_or_none()

    if package:
        package.avg_rating = float(avg_rating) if avg_rating else None
        await db.commit()


async def get_package_details(
    db: AsyncSession, package_id: int
) -> dict[str, Any] | None:
    """
    Get comprehensive package details including versions, ratings, etc.

    Args:
        db: Database session
        package_id: Package ID

    Returns:
        Dict with package details or None
    """
    package = await get_package_by_id(db, package_id)
    if not package:
        return None

    # Get latest version
    latest_version = await get_latest_version(db, package_id)

    # Get version count
    versions = await get_package_versions(db, package_id)

    # Get ratings count
    ratings_count_result = await db.execute(
        select(func.count())
        .select_from(PackageRating)
        .where(PackageRating.package_id == package_id)
    )
    ratings_count = ratings_count_result.scalar() or 0

    return {
        "package": package,
        "latest_version": latest_version,
        "total_versions": len(versions),
        "total_ratings": ratings_count,
    }
