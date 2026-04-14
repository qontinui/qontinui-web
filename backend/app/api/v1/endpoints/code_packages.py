"""
API endpoints for code package management.

Provides REST API for publishing, discovering, and installing community code packages.
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import code_package as crud
from app.models.code_package import PackageCategory, SecurityScanStatus
from app.models.project import Project
from app.models.user import User
from app.schemas.code_package import (
    CategoryRead,
    InstallRequest,
    InstallResponse,
    PackageCreate,
    PackageDetailRead,
    PackageListResponse,
    PackageRead,
    PackageUpdate,
    PopularPackageResponse,
    ProjectPackagesResponse,
    RatingCreate,
    RatingRead,
    TrendingPackageResponse,
    UninstallRequest,
    VersionCreate,
    VersionRead,
)
from app.services.package_installation_service import package_installation_service
from app.services.package_publishing_service import (
    PackageNotFoundError,
    PackageOwnershipError,
    SecurityScanFailedError,
    package_publishing_service,
)
from app.services.package_rating_service import package_rating_service
from app.services.package_response_builder import package_response_builder
from app.services.package_search_service import package_search_service
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


# ===== Helper Functions =====


async def verify_project_access(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
) -> Project:
    """Verify user has access to the project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )

    return project


async def get_package_or_404(db: AsyncSession, package_id: int):
    """Get package by ID or raise 404."""
    package = await crud.get_package_by_id(db, package_id)
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )
    return package


# ===== Category Endpoints =====


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    db: AsyncSession = Depends(get_async_db),
) -> list[PackageCategory]:
    """List all package categories."""
    return await crud.get_categories(db)


# ===== Package Publishing Endpoints =====


@router.post(
    "/packages", response_model=PackageRead, status_code=status.HTTP_201_CREATED
)
async def create_package(
    package_data: PackageCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new code package."""
    try:
        return await package_publishing_service.create_package(
            db, current_user.id, package_data
        )
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
    """Publish a new version of a package with security scanning."""
    try:
        return await package_publishing_service.publish_version(
            db, package_id, version_data, current_user.id
        )
    except PackageNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )
    except PackageOwnershipError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only package owner can publish versions",
        )
    except SecurityScanFailedError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": str(e),
                "scan_result": e.scan_result,
            },
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.put("/packages/{package_id}", response_model=PackageRead)
async def update_package(
    package_id: int,
    update_data: PackageUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update package metadata."""
    try:
        return await package_publishing_service.update_package(
            db, package_id, update_data, current_user.id
        )
    except PackageNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )
    except PackageOwnershipError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only package owner can update package",
        )


@router.delete("/packages/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_package(
    package_id: int,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a package (owner only)."""
    try:
        await package_publishing_service.delete_package(db, package_id, current_user.id)
    except PackageNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package not found",
        )
    except PackageOwnershipError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only package owner can delete package",
        )


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
    """Search and list packages with filters and pagination."""
    packages, total = await package_search_service.search(
        db,
        query=query,
        category_id=category,
        tags=tags,
        verified_only=verified_only,
        min_rating=min_rating,
        limit=limit,
        offset=offset,
    )

    results = await package_response_builder.build_search_results(db, packages)

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
    """Get detailed package information."""
    package = await get_package_or_404(db, package_id)
    return await package_response_builder.build_detail_response(db, package)


@router.get("/packages/{package_id}/versions", response_model=list[VersionRead])
async def list_package_versions(
    package_id: int,
    db: AsyncSession = Depends(get_async_db),
):
    """List all versions of a package."""
    await get_package_or_404(db, package_id)
    return await crud.get_package_versions(db, package_id)


@router.get("/packages/popular", response_model=PopularPackageResponse)
async def get_popular_packages(
    limit: int = Query(20, ge=1, le=100, description="Number of packages"),
    db: AsyncSession = Depends(get_async_db),
):
    """Get most popular packages by download count."""
    packages = await package_search_service.get_popular(db, limit=limit)
    results = await package_response_builder.build_search_results(db, packages)
    return PopularPackageResponse(packages=results, period="all")


@router.get("/packages/trending", response_model=TrendingPackageResponse)
async def get_trending_packages(
    days: int = Query(7, ge=1, le=90, description="Number of days to consider"),
    limit: int = Query(20, ge=1, le=100, description="Number of packages"),
    db: AsyncSession = Depends(get_async_db),
):
    """Get trending packages (recent + high ratings)."""
    packages = await package_search_service.get_trending(db, days=days, limit=limit)
    results = await package_response_builder.build_search_results(db, packages)
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
    """Install a package to a project."""
    # Validate package exists
    package = await get_package_or_404(db, package_id)

    # Determine version to install
    if request.version_id:
        version = await crud.get_version_by_id(db, request.version_id)
        if not version or version.package_id != package_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Version not found",
            )
    else:
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

    # Validate project access (request.package_id is actually project_id - schema issue)
    project_id = request.package_id  # type: ignore[assignment]
    await verify_project_access(db, project_id, current_user.id)  # type: ignore[arg-type]

    # Install package
    installation = await package_installation_service.install(
        db,
        project_id,  # type: ignore[arg-type]
        package_id,
        version.id,  # type: ignore[arg-type]
        current_user.id,
    )

    logger.info(
        "package_installed",
        package_id=package_id,
        version_id=version.id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return InstallResponse.model_validate(
        {
            "id": installation.id,
            "package_id": package_id,
            "version_id": version.id,
            "project_id": project_id,
            "status": installation.status,
            "installed_at": installation.installed_at,
            "package_name": package.name,
            "package_version": version.version,
        }
    )


@router.post("/packages/{package_id}/uninstall", status_code=status.HTTP_204_NO_CONTENT)
async def uninstall_package(
    package_id: int,
    request: UninstallRequest,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Uninstall a package from a project."""
    # request.package_id is actually project_id (schema naming issue)
    project_id = request.package_id  # type: ignore[assignment]
    await verify_project_access(db, project_id, current_user.id)  # type: ignore[arg-type]

    success = await package_installation_service.uninstall(db, project_id, package_id)  # type: ignore[arg-type]
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


@router.get("/projects/{project_id}/packages", response_model=ProjectPackagesResponse)
async def list_project_packages(
    project_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all packages installed in a project."""
    await verify_project_access(db, project_id, current_user.id)

    installations = await package_installation_service.get_project_packages(
        db, project_id
    )
    results = package_response_builder.build_installed_packages(installations)

    return ProjectPackagesResponse(packages=results, total=len(results))


# ===== Rating Endpoints =====


@router.post("/packages/{package_id}/ratings", response_model=RatingRead)
async def rate_package(
    package_id: int,
    rating_data: RatingCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Submit or update a rating for a package."""
    await get_package_or_404(db, package_id)

    rating = await package_rating_service.rate(
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


@router.get("/packages/{package_id}/ratings")
async def get_package_ratings(
    package_id: int,
    limit: int = Query(50, ge=1, le=100, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: AsyncSession = Depends(get_async_db),
):
    """Get ratings for a package."""
    await get_package_or_404(db, package_id)

    ratings, _ = await package_rating_service.get_package_ratings(
        db, package_id, limit=limit, offset=offset
    )

    return package_response_builder.build_ratings_with_users(ratings)


# ===== User Package Management =====


@router.get("/users/me/packages")
async def get_my_packages(
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get all packages published by the current user."""
    packages = await crud.get_user_packages(db, current_user.id)
    return await package_response_builder.build_search_results(db, packages)
