"""
Package response builder service.

Provides utilities for building consistent response objects from package models.
Extracted from code_packages.py for SRP compliance and code reuse.
"""

from typing import Any

from app.crud import code_package as crud
from app.models.code_package import CodePackage, PackageInstallation
from app.schemas.code_package import (
    InstalledPackageRead,
    PackageDetailRead,
    PackageSearchResult,
    RatingWithUser,
)
from sqlalchemy.ext.asyncio import AsyncSession


class PackageResponseBuilder:
    """
    Service for building package response objects.

    Handles consistent conversion of package models to API response schemas.
    """

    async def build_search_result(
        self,
        db: AsyncSession,
        package: CodePackage,
    ) -> PackageSearchResult:
        """
        Build a PackageSearchResult from a CodePackage model.

        Args:
            db: Database session for fetching related data
            package: CodePackage model

        Returns:
            PackageSearchResult response object
        """
        latest_version = await crud.get_latest_version(db, int(package.id))

        result_data: dict[str, Any] = {
            "id": package.id,
            "name": package.name,
            "slug": package.slug,
            "description": package.description,
            "author_id": package.author_id,
            "category_id": package.category_id,
            "category_name": package.category.name if package.category else None,
            "license": package.license,
            "tags": package.tags or [],
            "is_verified": package.is_verified,
            "total_downloads": package.total_downloads,
            "avg_rating": float(package.avg_rating) if package.avg_rating else None,
            "latest_version": latest_version.version if latest_version else None,
            "created_at": package.created_at,
        }
        return PackageSearchResult.model_validate(result_data)

    async def build_search_results(
        self,
        db: AsyncSession,
        packages: list[CodePackage],
    ) -> list[PackageSearchResult]:
        """
        Build a list of PackageSearchResult from CodePackage models.

        Args:
            db: Database session for fetching related data
            packages: List of CodePackage models

        Returns:
            List of PackageSearchResult response objects
        """
        results = []
        for package in packages:
            result = await self.build_search_result(db, package)
            results.append(result)
        return results

    async def build_detail_response(
        self,
        db: AsyncSession,
        package: CodePackage,
    ) -> PackageDetailRead:
        """
        Build a PackageDetailRead from a CodePackage model.

        Args:
            db: Database session for fetching related data
            package: CodePackage model

        Returns:
            PackageDetailRead response object
        """
        from app.services.package_rating_service import package_rating_service

        latest_version = await crud.get_latest_version(db, int(package.id))
        versions = await crud.get_package_versions(db, int(package.id))
        rating_summary = await package_rating_service.get_rating_summary(
            db, int(package.id)
        )

        detail_data: dict[str, Any] = {
            "id": package.id,
            "name": package.name,
            "slug": package.slug,
            "description": package.description,
            "long_description": package.long_description,
            "author_id": package.author_id,
            "category_id": package.category_id,
            "license": package.license,
            "tags": package.tags or [],
            "is_verified": package.is_verified,
            "total_downloads": package.total_downloads,
            "avg_rating": float(package.avg_rating) if package.avg_rating else None,
            "created_at": package.created_at,
            "updated_at": package.updated_at,
            "category": package.category,
            "latest_version": latest_version,
            "total_versions": len(versions),
            "total_ratings": rating_summary["total"],
        }
        return PackageDetailRead.model_validate(detail_data)

    def build_installed_package(
        self,
        installation: PackageInstallation,
    ) -> InstalledPackageRead:
        """
        Build an InstalledPackageRead from a PackageInstallation model.

        Args:
            installation: PackageInstallation model with loaded relationships

        Returns:
            InstalledPackageRead response object
        """
        installation_data = {
            "id": installation.id,
            "package_id": installation.package_id,
            "version_id": installation.version_id,
            "package_name": installation.package.name,
            "package_slug": installation.package.slug,
            "package_description": installation.package.description,
            "version": installation.version.version,
            "status": installation.status,
            "installed_at": installation.installed_at,
            "updated_at": installation.updated_at,
        }
        return InstalledPackageRead.model_validate(installation_data)

    def build_installed_packages(
        self,
        installations: list[PackageInstallation],
    ) -> list[InstalledPackageRead]:
        """
        Build a list of InstalledPackageRead from PackageInstallation models.

        Args:
            installations: List of PackageInstallation models

        Returns:
            List of InstalledPackageRead response objects
        """
        return [self.build_installed_package(inst) for inst in installations]

    def build_rating_with_user(
        self,
        rating: Any,
    ) -> RatingWithUser:
        """
        Build a RatingWithUser from a PackageRating model.

        Args:
            rating: PackageRating model with loaded user relationship

        Returns:
            RatingWithUser response object
        """
        rating_data = {
            "id": rating.id,
            "package_id": rating.package_id,
            "user_id": rating.user_id,
            "rating": rating.rating,
            "review_text": rating.review_text,
            "created_at": rating.created_at,
            "updated_at": rating.updated_at,
            "user_email": rating.user.email,
            "user_username": rating.user.username,
        }
        return RatingWithUser.model_validate(rating_data)

    def build_ratings_with_users(
        self,
        ratings: list[Any],
    ) -> list[RatingWithUser]:
        """
        Build a list of RatingWithUser from PackageRating models.

        Args:
            ratings: List of PackageRating models

        Returns:
            List of RatingWithUser response objects
        """
        return [self.build_rating_with_user(r) for r in ratings]


# Singleton instance for dependency injection
package_response_builder = PackageResponseBuilder()
