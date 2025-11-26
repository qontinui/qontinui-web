"""
API endpoints for code package management.

Provides REST API for publishing, discovering, and installing community code packages.
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import code_package as crud
from app.models.code_package import PackageCategory, PackageVersion, SecurityScanStatus
from app.models.project import Project
from app.models.user import User
from app.schemas.code_package import (
    CategoryRead,
    InstalledPackageRead,
    InstallRequest,
    InstallResponse,
    PackageCreate,
    PackageDetailRead,
    PackageListResponse,
    PackageRead,
    PackageSearchFilters,
    PackageSearchResult,
    PackageUpdate,
    PopularPackageResponse,
    ProjectPackagesResponse,
    RatingCreate,
    RatingRead,
    RatingWithUser,
    TrendingPackageResponse,
    UninstallRequest,
    VersionCreate,
    VersionRead,
)
from app.services.code_security import CodeSecurityScanner, SecurityStatus
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


# ===== Category Endpoints =====


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    db: AsyncSession = Depends(get_async_db),
) -> list[PackageCategory]:
    """
    List all package categories.

    Returns:
        List of package categories
    """
    categories = await crud.get_categories(db)
    return categories


# ===== Package Publishing Endpoints =====


@router.post(
    "/packages", response_model=PackageRead, status_code=status.HTTP_201_CREATED
)
async def create_package(
    package_data: PackageCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Create a new code package.

    Args:
        package_data: Package creation data
        current_user: Authenticated user
        db: Database session

    Returns:
        Created package

    Raises:
        HTTPException: If package name already exists
    """
    try:
        package = await crud.create_package(db, current_user.id, package_data)
        logger.info("package_created", package_id=package.id, user_id=current_user.id)
        return package
    except Exception as e:
        logger.error("package_creation_failed", error=str(e), user_id=current_user.id)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create package: {str(e)}",
        )


@router.post(
    "/packages/{package_id}/versions",
    response_model=VersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def publish_version(
    package_id: int,
    version_data: VersionCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Publish a new version of a package.

    This endpoint:
    1. Validates ownership
    2. Creates version record
    3. Runs security scan on code
    4. Rejects if security scan fails

    Args:
        package_id: Package ID
        version_data: Version creation data
        current_user: Authenticated user
        db: Database session

    Returns:
        Created version with security scan results

    Raises:
        HTTPException: If package not found, not authorized, version exists, or security scan fails
    """
    # Check package exists and user is owner
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    if package.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only package owner can publish versions",
        )

    # Create version (with PENDING security status)
    try:
        version = await crud.publish_version(db, package_id, version_data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # Run security scan
    scanner = CodeSecurityScanner()
    scan_result = scanner.scan_code(
        version_data.code_content, verified=package.is_verified
    )

    # Update version with scan results
    scan_status_map = {
        SecurityStatus.PASSED: SecurityScanStatus.PASSED.value,
        SecurityStatus.WARNING: SecurityScanStatus.PASSED.value,  # Allow with warnings
        SecurityStatus.FAILED: SecurityScanStatus.FAILED.value,
    }

    version = await crud.update_version_security_scan(
        db,
        version,
        scan_status_map[scan_result.status],
        scan_result.model_dump(),
    )

    # Reject if security scan failed
    if scan_result.status == SecurityStatus.FAILED:
        logger.warning(
            "version_publish_rejected",
            package_id=package_id,
            version_id=version.id,
            user_id=current_user.id,
            risk_score=scan_result.risk_score,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Security scan failed - version cannot be published",
                "scan_result": scan_result.model_dump(),
            },
        )

    # Log warning if has warnings
    if scan_result.status == SecurityStatus.WARNING:
        logger.info(
            "version_published_with_warnings",
            package_id=package_id,
            version_id=version.id,
            user_id=current_user.id,
            warnings_count=len(
                [i for i in scan_result.issues if i.severity.value == "medium"]
            ),
        )

    logger.info(
        "version_published",
        package_id=package_id,
        version_id=version.id,
        version=version.version,
        user_id=current_user.id,
    )
    return version


@router.put("/packages/{package_id}", response_model=PackageRead)
async def update_package(
    package_id: int,
    update_data: PackageUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Update package metadata.

    Args:
        package_id: Package ID
        update_data: Update data
        current_user: Authenticated user
        db: Database session

    Returns:
        Updated package

    Raises:
        HTTPException: If package not found or not authorized
    """
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    if package.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only package owner can update package",
        )

    package = await crud.update_package(db, package, update_data)
    logger.info("package_updated", package_id=package_id, user_id=current_user.id)
    return package


@router.delete("/packages/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_package(
    package_id: int,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Delete a package (owner only).

    Args:
        package_id: Package ID
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If package not found or not authorized
    """
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    if package.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only package owner can delete package",
        )

    await crud.delete_package(db, package)
    logger.info("package_deleted", package_id=package_id, user_id=current_user.id)
    return None


# ===== Discovery Endpoints =====


@router.get("/packages", response_model=PackageListResponse)
async def search_packages(
    query: str | None = Query(None, description="Search query"),
    category: int | None = Query(None, description="Category ID"),
    tags: list[str] | None = Query(None, description="Filter by tags"),
    verified_only: bool = Query(False, description="Only verified packages"),
    min_rating: float | None = Query(None, ge=0, le=5, description="Minimum rating"),
    limit: int = Query(20, ge=1, le=100, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Search and list packages with filters and pagination.

    Args:
        query: Text search (name, description)
        category: Category ID filter
        tags: Tag filters
        verified_only: Only return verified packages
        min_rating: Minimum average rating
        limit: Results per page
        offset: Pagination offset
        db: Database session

    Returns:
        Paginated list of packages
    """
    packages, total = await crud.search_packages(
        db,
        query=query,
        category=category,
        tags=tags,
        verified_only=verified_only,
        min_rating=min_rating,
        limit=limit,
        offset=offset,
    )

    # Get latest version for each package
    results = []
    for package in packages:
        latest_version = await crud.get_latest_version(db, package.id)

        results.append(
            PackageSearchResult(
                id=package.id,
                name=package.name,
                slug=package.slug,
                description=package.description,
                author_id=package.author_id,
                category_id=package.category_id,
                category_name=package.category.name if package.category else None,
                license=package.license,
                tags=package.tags or [],
                is_verified=package.is_verified,
                total_downloads=package.total_downloads,
                avg_rating=float(package.avg_rating) if package.avg_rating else None,
                latest_version=latest_version.version if latest_version else None,
                created_at=package.created_at,
            )
        )

    return PackageListResponse(
        packages=results,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.get("/packages/{package_id}", response_model=PackageDetailRead)
async def get_package_details(
    package_id: int,
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get detailed package information.

    Args:
        package_id: Package ID
        db: Database session

    Returns:
        Package details with version info

    Raises:
        HTTPException: If package not found
    """
    details = await crud.get_package_details(db, package_id)
    if not details:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    package = details["package"]
    latest_version = details["latest_version"]

    return PackageDetailRead(
        id=package.id,
        name=package.name,
        slug=package.slug,
        description=package.description,
        long_description=package.long_description,
        author_id=package.author_id,
        category_id=package.category_id,
        license=package.license,
        tags=package.tags or [],
        is_verified=package.is_verified,
        total_downloads=package.total_downloads,
        avg_rating=float(package.avg_rating) if package.avg_rating else None,
        created_at=package.created_at,
        updated_at=package.updated_at,
        category=package.category,
        latest_version=latest_version,
        total_versions=details["total_versions"],
        total_ratings=details["total_ratings"],
    )


@router.get("/packages/{package_id}/versions", response_model=list[VersionRead])
async def list_package_versions(
    package_id: int,
    db: AsyncSession = Depends(get_async_db),
):
    """
    List all versions of a package.

    Args:
        package_id: Package ID
        db: Database session

    Returns:
        List of versions (newest first)

    Raises:
        HTTPException: If package not found
    """
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    versions = await crud.get_package_versions(db, package_id)
    return versions


@router.get("/packages/popular", response_model=PopularPackageResponse)
async def get_popular_packages(
    limit: int = Query(20, ge=1, le=100, description="Number of packages"),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get most popular packages by download count.

    Args:
        limit: Number of packages to return
        db: Database session

    Returns:
        List of popular packages
    """
    packages = await crud.get_popular_packages(db, limit=limit)

    results = []
    for package in packages:
        latest_version = await crud.get_latest_version(db, package.id)

        results.append(
            PackageSearchResult(
                id=package.id,
                name=package.name,
                slug=package.slug,
                description=package.description,
                author_id=package.author_id,
                category_id=package.category_id,
                category_name=package.category.name if package.category else None,
                license=package.license,
                tags=package.tags or [],
                is_verified=package.is_verified,
                total_downloads=package.total_downloads,
                avg_rating=float(package.avg_rating) if package.avg_rating else None,
                latest_version=latest_version.version if latest_version else None,
                created_at=package.created_at,
            )
        )

    return PopularPackageResponse(packages=results, period="all")


@router.get("/packages/trending", response_model=TrendingPackageResponse)
async def get_trending_packages(
    days: int = Query(7, ge=1, le=90, description="Number of days to consider"),
    limit: int = Query(20, ge=1, le=100, description="Number of packages"),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get trending packages (recent + high ratings).

    Args:
        days: Number of days to consider
        limit: Number of packages to return
        db: Database session

    Returns:
        List of trending packages
    """
    packages = await crud.get_trending_packages(db, days=days, limit=limit)

    results = []
    for package in packages:
        latest_version = await crud.get_latest_version(db, package.id)

        results.append(
            PackageSearchResult(
                id=package.id,
                name=package.name,
                slug=package.slug,
                description=package.description,
                author_id=package.author_id,
                category_id=package.category_id,
                category_name=package.category.name if package.category else None,
                license=package.license,
                tags=package.tags or [],
                is_verified=package.is_verified,
                total_downloads=package.total_downloads,
                avg_rating=float(package.avg_rating) if package.avg_rating else None,
                latest_version=latest_version.version if latest_version else None,
                created_at=package.created_at,
            )
        )

    period = "week" if days <= 7 else ("month" if days <= 30 else "all")
    return TrendingPackageResponse(packages=results, period=period)


# ===== Installation Endpoints =====


@router.post("/packages/{package_id}/install", response_model=InstallResponse)
async def install_package(
    package_id: int,
    request: InstallRequest,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Install a package to a project.

    Args:
        package_id: Package ID (from URL)
        request: Installation request with project_id and optional version_id
        current_user: Authenticated user
        db: Database session

    Returns:
        Installation details

    Raises:
        HTTPException: If package/project not found, version has security issues
    """
    # Validate package exists
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    # Determine version to install
    if request.version_id:
        version = await crud.get_version_by_id(db, request.version_id)
        if not version or version.package_id != package_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Version not found",
            )
    else:
        # Install latest version
        version = await crud.get_latest_version(db, package_id)
        if not version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No versions available for this package",
            )

    # Check security scan status
    if version.security_scan_status == SecurityScanStatus.FAILED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot install package version with failed security scan",
        )

    # Validate project exists and user has access
    from sqlalchemy import select

    project_result = await db.execute(
        select(Project).where(Project.id == request.package_id)
    )
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check project ownership/access
    if project.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )

    # Install package
    installation = await crud.install_package(
        db, request.package_id, package_id, version.id, current_user.id
    )

    logger.info(
        "package_installed",
        package_id=package_id,
        version_id=version.id,
        project_id=request.package_id,
        user_id=current_user.id,
    )

    return InstallResponse(
        id=installation.id,
        package_id=package_id,
        version_id=version.id,
        project_id=request.package_id,
        status=installation.status,
        installed_at=installation.installed_at,
        package_name=package.name,
        package_version=version.version,
    )


@router.post("/packages/{package_id}/uninstall", status_code=status.HTTP_204_NO_CONTENT)
async def uninstall_package(
    package_id: int,
    request: UninstallRequest,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Uninstall a package from a project.

    Args:
        package_id: Package ID (from URL, should match request)
        request: Uninstall request with project_id
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If not found or not authorized
    """
    # Note: request.package_id is actually project_id (reusing InstallRequest schema)
    # This is a design issue but keeping for now
    project_id = request.package_id

    # Validate project access
    from sqlalchemy import select

    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )

    # Uninstall package
    success = await crud.uninstall_package(db, project_id, package_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not installed in this project",
        )

    logger.info(
        "package_uninstalled",
        package_id=package_id,
        project_id=project_id,
        user_id=current_user.id,
    )
    return None


@router.get("/projects/{project_id}/packages", response_model=ProjectPackagesResponse)
async def list_project_packages(
    project_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    List all packages installed in a project.

    Args:
        project_id: Project ID
        current_user: Authenticated user
        db: Database session

    Returns:
        List of installed packages

    Raises:
        HTTPException: If project not found or not authorized
    """
    # Validate project access
    from sqlalchemy import select

    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )

    installations = await crud.get_project_packages(db, project_id)

    results = []
    for installation in installations:
        results.append(
            InstalledPackageRead(
                id=installation.id,
                package_id=installation.package_id,
                version_id=installation.version_id,
                package_name=installation.package.name,
                package_slug=installation.package.slug,
                package_description=installation.package.description,
                version=installation.version.version,
                status=installation.status,
                installed_at=installation.installed_at,
                updated_at=installation.updated_at,
            )
        )

    return ProjectPackagesResponse(packages=results, total=len(results))


# ===== Rating Endpoints =====


@router.post("/packages/{package_id}/ratings", response_model=RatingRead)
async def rate_package(
    package_id: int,
    rating_data: RatingCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Submit or update a rating for a package.

    Args:
        package_id: Package ID
        rating_data: Rating data (1-5 stars + optional review)
        current_user: Authenticated user
        db: Database session

    Returns:
        Rating record

    Raises:
        HTTPException: If package not found
    """
    # Validate package exists
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    rating = await crud.rate_package(
        db,
        current_user.id,
        package_id,
        rating_data.rating,
        rating_data.review_text,
    )

    logger.info(
        "package_rated",
        package_id=package_id,
        rating=rating_data.rating,
        user_id=current_user.id,
    )

    return rating


@router.get("/packages/{package_id}/ratings", response_model=list[RatingWithUser])
async def get_package_ratings(
    package_id: int,
    limit: int = Query(50, ge=1, le=100, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get ratings for a package.

    Args:
        package_id: Package ID
        limit: Results per page
        offset: Pagination offset
        db: Database session

    Returns:
        List of ratings with user information

    Raises:
        HTTPException: If package not found
    """
    # Validate package exists
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )

    ratings, _ = await crud.get_package_ratings(
        db, package_id, limit=limit, offset=offset
    )

    results = []
    for rating in ratings:
        results.append(
            RatingWithUser(
                id=rating.id,
                package_id=rating.package_id,
                user_id=rating.user_id,
                rating=rating.rating,
                review_text=rating.review_text,
                created_at=rating.created_at,
                updated_at=rating.updated_at,
                user_email=rating.user.email,
                user_username=rating.user.username,
            )
        )

    return results


# ===== User Package Management =====


@router.get("/users/me/packages", response_model=list[PackageSearchResult])
async def get_my_packages(
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all packages published by the current user.

    Args:
        current_user: Authenticated user
        db: Database session

    Returns:
        List of user's packages
    """
    packages = await crud.get_user_packages(db, current_user.id)

    results = []
    for package in packages:
        latest_version = await crud.get_latest_version(db, package.id)

        results.append(
            PackageSearchResult(
                id=package.id,
                name=package.name,
                slug=package.slug,
                description=package.description,
                author_id=package.author_id,
                category_id=package.category_id,
                category_name=package.category.name if package.category else None,
                license=package.license,
                tags=package.tags or [],
                is_verified=package.is_verified,
                total_downloads=package.total_downloads,
                avg_rating=float(package.avg_rating) if package.avg_rating else None,
                latest_version=latest_version.version if latest_version else None,
                created_at=package.created_at,
            )
        )

    return results
